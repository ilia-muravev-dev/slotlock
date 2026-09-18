import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PG, pgCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';
import { NotificationSink } from './notification.sink';

class AlreadyProcessed extends Error {}

/**
 * Exactly-once processing on top of at-least-once delivery: the job id is claimed in
 * `processed_jobs` inside a transaction, the notification is delivered, and only then does the
 * claim commit. A redelivery finds the claim and does nothing. If delivery fails, the claim rolls
 * back and BullMQ retries; if the process dies between delivering and committing, the
 * notification goes out twice — the one window this design accepts, and it is the sink's to close.
 */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 10 })
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sink: NotificationSink,
  ) {
    super();
  }

  async process(job: Job): Promise<'delivered' | 'duplicate'> {
    const key = String(job.id);
    try {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.processedJob.create({ data: { key } });
        } catch (error) {
          if (pgCode(error) === PG.uniqueViolation) throw new AlreadyProcessed();
          throw error;
        }
        await this.sink.deliver({ id: key, type: job.name, payload: job.data });
      });
      return 'delivered';
    } catch (error) {
      if (error instanceof AlreadyProcessed) return 'duplicate';
      throw error;
    }
  }
}
