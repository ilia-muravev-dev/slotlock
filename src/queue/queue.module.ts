import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

export const HOLDS_QUEUE = 'holds';
export const NOTIFICATIONS_QUEUE = 'notifications';

/** BullMQ on the configured Redis; both queues are registered once, here, for API and worker. */
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
    BullModule.registerQueue({ name: HOLDS_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
