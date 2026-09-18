import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CONFIG, type Config } from './config';
import { ConfigModule } from './config.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';

/** What every process needs: configuration, logging, the database and the queues. */
@Module({})
export class CoreModule {
  static forRoot(config?: Config): DynamicModule {
    return {
      module: CoreModule,
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
        QueueModule,
      ],
      exports: [ConfigModule, LoggerModule, PrismaModule, QueueModule],
    };
  }
}
