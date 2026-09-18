import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { HOLDS_QUEUE } from '../../queue/queue.module';
import { EXPIRE_JOB, type ExpireJobData, SWEEP_JOB } from './hold.scheduler';
import { HoldExpiryService } from './hold-expiry.service';

@Processor(HOLDS_QUEUE, { concurrency: 10 })
export class HoldsProcessor extends WorkerHost {
  constructor(
    private readonly expiry: HoldExpiryService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case EXPIRE_JOB: {
        const { bookingId } = job.data as ExpireJobData;
        const result = await this.expiry.expire(bookingId);
        this.logger.debug({ bookingId, result }, 'hold expiry job');
        return result;
      }
      case SWEEP_JOB: {
        const expired = await this.expiry.sweep();
        if (expired > 0) this.logger.log({ expired }, 'hold sweeper expired overdue holds');
        return expired;
      }
      default:
        throw new Error(`unknown job ${job.name} on ${HOLDS_QUEUE}`);
    }
  }
}
