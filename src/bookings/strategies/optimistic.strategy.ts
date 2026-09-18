import { Injectable } from '@nestjs/common';
import { NoCapacityError, RetryExhaustedError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  countOverlapping,
  insertHeld,
  jitter,
  type ReservedBooking,
  type ReserveInput,
  type ReserveStrategy,
  sleep,
} from './reserve.strategy';

class VersionConflict extends Error {}

/**
 * No locks: count, insert, then bump the resource's version guarded by the version we read.
 * A competing transaction that committed first makes the guarded update touch 0 rows; we roll
 * back and try again, and the retry's count sees the winner's booking.
 */
@Injectable()
export class OptimisticStrategy implements ReserveStrategy {
  readonly name = 'optimistic' as const;
  static readonly MAX_ATTEMPTS = 6;
  attempts = 0;
  retries = 0;

  constructor(private readonly prisma: PrismaService) {}

  async reserve(input: ReserveInput): Promise<ReservedBooking> {
    for (let attempt = 0; ; attempt += 1) {
      this.attempts += 1;
      try {
        return await this.prisma.$transaction(async (tx) => {
          const seen = await tx.resource.findUniqueOrThrow({
            where: { id: input.resource.id },
            select: { version: true },
          });
          if ((await countOverlapping(tx, input)) >= input.resource.capacity) {
            throw new NoCapacityError(input.resource.id);
          }
          const booking = await insertHeld(tx, input);
          const bumped = await tx.resource.updateMany({
            where: { id: input.resource.id, version: seen.version },
            data: { version: { increment: 1 } },
          });
          if (bumped.count === 0) throw new VersionConflict();
          return booking;
        });
      } catch (error) {
        if (!(error instanceof VersionConflict)) throw error;
        if (attempt + 1 >= OptimisticStrategy.MAX_ATTEMPTS) {
          throw new RetryExhaustedError(this.name, OptimisticStrategy.MAX_ATTEMPTS);
        }
        this.retries += 1;
        await sleep(jitter(attempt));
      }
    }
  }
}
