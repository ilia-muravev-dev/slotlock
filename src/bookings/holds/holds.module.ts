import { Module } from '@nestjs/common';
import { PaymentsModule } from '../../payments/payments.module';
import { HoldScheduler } from './hold.scheduler';
import { HoldExpiryService } from './hold-expiry.service';

/** Scheduling and expiring holds — used by the API (schedule) and the worker (expire). */
@Module({
  imports: [PaymentsModule],
  providers: [HoldScheduler, HoldExpiryService],
  exports: [HoldScheduler, HoldExpiryService],
})
export class HoldsModule {}
