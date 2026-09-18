import { Injectable } from '@nestjs/common';
import { NoCapacityError, PG, pgCode } from '../../common/errors';
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
 */
@Injectable()
export class ExclusionStrategy implements ReserveStrategy {
  readonly name = 'exclusion' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly advisory: AdvisoryStrategy,
  ) {}

  async reserve(input: ReserveInput): Promise<ReservedBooking> {
    if (!input.resource.exclusive) return this.advisory.reserve(input);
    try {
      return await this.prisma.$transaction((tx) => insertHeld(tx, input));
    } catch (error) {
      if (pgCode(error) === PG.exclusionViolation || String(error).includes(EXCLUSION_CONSTRAINT)) {
        throw new NoCapacityError(input.resource.id);
      }
      throw error;
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
