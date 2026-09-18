import { Injectable } from '@nestjs/common';
import { isRetryableConflict, NoCapacityError, RetryExhaustedError } from '../../common/errors';
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

/**
 * The textbook answer: the same count-then-insert in a SERIALIZABLE transaction. Postgres tracks
 * the predicate the count read; a concurrent insert into it fails one of the transactions at
 * commit with 40001, and that one is retried.
 */
@Injectable()
export class SerializableStrategy implements ReserveStrategy {
  readonly name = 'serializable' as const;
  static readonly MAX_ATTEMPTS = 8;
  attempts = 0;
  retries = 0;

  constructor(private readonly prisma: PrismaService) {}

  async reserve(input: ReserveInput): Promise<ReservedBooking> {
    for (let attempt = 0; ; attempt += 1) {
      this.attempts += 1;
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if ((await countOverlapping(tx, input)) >= input.resource.capacity) {
              throw new NoCapacityError(input.resource.id);
            }
            return insertHeld(tx, input);
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isRetryableConflict(error)) throw error;
        if (attempt + 1 >= SerializableStrategy.MAX_ATTEMPTS) {
          throw new RetryExhaustedError(this.name, SerializableStrategy.MAX_ATTEMPTS);
        }
        this.retries += 1;
        await sleep(jitter(attempt));
      }
    }
  }
}
