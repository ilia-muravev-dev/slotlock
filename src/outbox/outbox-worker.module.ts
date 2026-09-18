import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CONFIG, type Config } from '../config';
import { OUTBOX_QUEUE } from '../queue/queue.module';
import { NotificationSink } from './notification.sink';
import { NotificationsProcessor } from './notifications.processor';
import { OutboxRelay } from './outbox.relay';

export const RELAY_JOB = 'relay';
export const RELAY_SCHEDULER_ID = 'outbox-relay';

/** The repeatable relay tick lives on its own queue so it never queues behind notifications. */
@Processor(OUTBOX_QUEUE)
class OutboxProcessor extends WorkerHost {
  constructor(private readonly relay: OutboxRelay) {
    super();
  }

  process(job: Job): Promise<number> {
    if (job.name !== RELAY_JOB) throw new Error(`unknown job ${job.name} on ${OUTBOX_QUEUE}`);
    return this.relay.relay();
  }
}

/** The worker side of the outbox: relay tick, notifications consumer, the sink. */
@Module({
  providers: [OutboxRelay, OutboxProcessor, NotificationsProcessor, NotificationSink],
  exports: [OutboxRelay, NotificationSink],
})
export class OutboxWorkerModule implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RELAY_SCHEDULER_ID,
      { every: this.config.OUTBOX_RELAY_INTERVAL_MS },
      { name: RELAY_JOB, data: {} },
    );
  }
}
