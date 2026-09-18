import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { HOLDS_QUEUE } from '../../queue/queue.module';

export const EXPIRE_JOB = 'expire';
export const SWEEP_JOB = 'sweep';
export const SWEEPER_ID = 'hold-sweeper';

export interface ExpireJobData {
  bookingId: string;
}

/** BullMQ forbids ':' in custom job ids. */
export function expireJobId(bookingId: string): string {
  return `${EXPIRE_JOB}-${bookingId}`;
}

/**
 * One delayed job per hold, keyed by the booking id so a retried request cannot schedule two. If
 * Redis is unavailable the booking still stands: the sweeper (a repeatable job on the same queue)
 * expires anything the delayed job missed.
 */
@Injectable()
export class HoldScheduler {
  constructor(
    @InjectQueue(HOLDS_QUEUE) private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async schedule(bookingId: string, holdExpiresAt: Date, now = new Date()): Promise<void> {
    const delay = Math.max(0, holdExpiresAt.getTime() - now.getTime());
    try {
      await this.queue.add(EXPIRE_JOB, { bookingId } satisfies ExpireJobData, {
        jobId: expireJobId(bookingId),
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      });
    } catch (error) {
      this.logger.warn(
        { err: error, bookingId },
        'could not schedule hold expiry; the sweeper will catch it',
      );
    }
  }

  /** The safety net: `sweep` runs every `everyMs`, however many workers there are. */
  async ensureSweeper(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEPER_ID,
      { every: everyMs },
      { name: SWEEP_JOB, data: {} },
    );
  }
}
