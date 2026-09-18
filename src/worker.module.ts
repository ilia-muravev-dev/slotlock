import { DynamicModule, Module } from '@nestjs/common';
import { HoldsWorkerModule } from './bookings/holds/holds-worker.module';
import { type Config } from './config';
import { CoreModule } from './core.module';
import { OutboxWorkerModule } from './outbox/outbox-worker.module';
import { PaymentsModule } from './payments/payments.module';

/** The worker process: BullMQ processors and the periodic jobs. No HTTP. */
@Module({})
export class WorkerModule {
  static forRoot(config?: Config): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(config), PaymentsModule, HoldsWorkerModule, OutboxWorkerModule],
    };
  }
}
