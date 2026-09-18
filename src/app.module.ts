import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { BookingsModule } from './bookings/bookings.module';
import { CONFIG, type Config } from './config';
import { ConfigModule } from './config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ResourcesModule } from './resources/resources.module';

@Module({})
export class AppModule {
  /** The application graph; `config` lets tests inject a container's connection details. */
  static forRoot(config?: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRootAsync({
          inject: [CONFIG],
          useFactory: (cfg: Config) => ({
            pinoHttp: {
              level: cfg.LOG_LEVEL,
              redact: ['req.headers.authorization', 'req.headers["stripe-signature"]'],
              ...(cfg.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
            },
          }),
        }),
        PrismaModule,
        ResourcesModule,
        BookingsModule,
      ],
      controllers: [HealthController],
    };
  }
}
