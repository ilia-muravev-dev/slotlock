import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PaymentsModule } from '../payments/payments.module';
import { BookingsController } from './bookings.controller';
import { BookingsService, CLOCK, systemClock } from './bookings.service';
import { StrategyModule } from './strategies/strategy.module';

@Module({
  imports: [StrategyModule, IdempotencyModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, { provide: CLOCK, useValue: systemClock }],
  exports: [BookingsService],
})
export class BookingsModule {}
