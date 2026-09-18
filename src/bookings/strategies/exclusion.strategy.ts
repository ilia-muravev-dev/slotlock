import { Injectable } from '@nestjs/common';
import {
  isRetryableConflict,
  NoCapacityError,
  PG,
  pgCode,
  RetryExhaustedError,
} from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AdvisoryStrategy } from './advisory.strategy';
import {
  insertHeld,
  type ReservedBooking,
  type ReserveInput,
  type ReserveStrategy,
} from './reserve.strategy';

export const EXCLUSION_CONSTRAINT = 'booking_no_overlap';

/**
 * Let the database say no: a GiST exclusion constraint rejects an overlapping active booking on an
 * exclusive resource, so the insert simply fails with 23P01. "At most N" cannot be expressed this
 * way, so pools use the advisory strategy underneath.
 *
 * The insert is a single autocommit statement rather than an interactive transaction. Postgres
 * checks an exclusion constraint after inserting the index entry, so two concurrent inserters can
 * each find the other's uncommitted row and wait on each other; the deadlock detector then aborts
 * one of them with 40P01 (after deadlock_timeout, 1 s by default), and that one retries and gets
 * its 23P01. A client-side transaction timeout would only add a way to lose the row that would
 * have won.
 */
@Injectable()
export class ExclusionStrategy implements ReserveStrategy {
  readonly name = 'exclusion' as const;
  static readonly MAX_ATTEMPTS = 5;
  attempts = 0;
  deadlocks = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly advisory: AdvisoryStrategy,
  ) {}

  async reserve(input: ReserveInput): Promise<ReservedBooking> {
    if (!input.resource.exclusive) return this.advisory.reserve(input);
    for (let attempt = 0; ; attempt += 1) {
      this.attempts += 1;
      try {
        return await insertHeld(this.prisma, input);
      } catch (error) {
        const code = pgCode(error);
        if (code === PG.exclusionViolation || String(error).includes(EXCLUSION_CONSTRAINT)) {
          throw new NoCapacityError(input.resource.id);
        }
        if (!isRetryableConflict(error)) throw error;
        this.deadlocks += 1;
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
