import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

export const HOLDS_QUEUE = 'holds';
export const NOTIFICATIONS_QUEUE = 'notifications';
export const OUTBOX_QUEUE = 'outbox';

/** BullMQ on the configured Redis; the queues are registered once, here, for API and worker. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (cfg: Config) => ({
        connection: { url: cfg.REDIS_URL },
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      }),
    }),
    BullModule.registerQueue(
      { name: HOLDS_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
      { name: OUTBOX_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
