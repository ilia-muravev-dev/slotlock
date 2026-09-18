import { Injectable } from '@nestjs/common';
import { isRetryableConflict, NoCapacityError, RetryExhaustedError } from '../../common/errors';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdvisoryStrategy } from './advisory.strategy';
import type { ReservedBooking, ReserveInput, ReserveStrategy } from './reserve.strategy';

export const EXCLUSION_CONSTRAINT = 'booking_no_overlap';
const EXCLUSION_CONSTRAINT_SQL = Prisma.raw(EXCLUSION_CONSTRAINT);

/**
 * Let the database say no: a GiST exclusion constraint rejects an overlapping active booking on an
 * exclusive resource. "At most N" cannot be expressed this way, so pools use the advisory strategy
 * underneath.
 *
 * The insert is `ON CONFLICT ON CONSTRAINT … DO NOTHING`, not a plain insert that fails with
 * 23P01. Postgres checks an exclusion constraint after it has inserted the index entry, so N
 * plain inserts for the same slot each find the others' uncommitted rows and wait on each other;
 * the deadlock detector then unpicks them one `deadlock_timeout` (1 s) at a time, and retrying
 * victims re-enter the fight. `ON CONFLICT` uses speculative insertion: the pre-check waits for
 * in-flight rows before inserting anything, so there is nothing to deadlock on, and a committed
 * winner simply makes the insert return no row.
 */
@Injectable()
export class ExclusionStrategy implements ReserveStrategy {
  readonly name = 'exclusion' as const;
  static readonly MAX_ATTEMPTS = 5;
  attempts = 0;
  retries = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly advisory: AdvisoryStrategy,
  ) {}

  async reserve(input: ReserveInput): Promise<ReservedBooking> {
    if (!input.resource.exclusive) return this.advisory.reserve(input);
    for (let attempt = 0; ; attempt += 1) {
      this.attempts += 1;
      try {
        const rows = await this.prisma.$queryRaw<ReservedBooking[]>`
          INSERT INTO bookings
            ("id", "resourceId", "userId", "startsAt", "endsAt", "exclusive", "status",
             "holdExpiresAt", "createdAt", "updatedAt")
          VALUES
            (gen_random_uuid()::text, ${input.resource.id}, ${input.userId}, ${input.startsAt},
             ${input.endsAt}, true, 'HELD'::"BookingStatus", ${input.holdExpiresAt}, now(), now())
          ON CONFLICT ON CONSTRAINT ${EXCLUSION_CONSTRAINT_SQL} DO NOTHING
          RETURNING "id", "resourceId", "userId", "startsAt", "endsAt", "status", "holdExpiresAt"`;
        const booking = rows[0];
        if (!booking) throw new NoCapacityError(input.resource.id);
        return booking;
      } catch (error) {
        if (!isRetryableConflict(error)) throw error;
        this.retries += 1;
        if (attempt + 1 >= ExclusionStrategy.MAX_ATTEMPTS) {
          throw new RetryExhaustedError(this.name, ExclusionStrategy.MAX_ATTEMPTS);
        }
      }
    }
  }

  /** Adds or drops the constraint so it only exists while this strategy is active. */
  static async ensureConstraint(prisma: PrismaService, active: boolean): Promise<void> {
    if (active) {
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${EXCLUSION_CONSTRAINT}') THEN
            ALTER TABLE bookings ADD CONSTRAINT ${EXCLUSION_CONSTRAINT}
              EXCLUDE USING gist ("resourceId" WITH =, tstzrange("startsAt", "endsAt") WITH &&)
              WHERE ("exclusive" AND status IN ('HELD', 'CONFIRMED'));
          END IF;
        END $$;`);
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ${EXCLUSION_CONSTRAINT}`,
      );
    }
  }
}
