import { DynamicModule, Module } from '@nestjs/common';
import { BookingsModule } from './bookings/bookings.module';
import { StrategyModule } from './bookings/strategies/strategy.module';
import { type Config } from './config';
import { CoreModule } from './core.module';
import { HealthController } from './health/health.controller';
import { PaymentsModule } from './payments/payments.module';
import { ResourcesModule } from './resources/resources.module';

/** The API process. `config` lets tests inject a container's connection details. */
@Module({})
export class AppModule {
  static forRoot(config?: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        PaymentsModule,
        ResourcesModule,
        BookingsModule,
        StrategyModule,
      ],
      controllers: [HealthController],
    };
  }
}
