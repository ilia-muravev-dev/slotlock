import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { CONFIG, type Config } from './config';

export async function createApp(config?: Config): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true, rawBody: true },
  );
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new HttpExceptionFilter(app.get(Logger)));
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('slotlock')
      .setDescription(
        'A reservation API that cannot double-book. Rooms are exclusive, desk pools have a ' +
          'capacity; a booking is HELD while the customer pays, CONFIRMED by the payment ' +
          'webhook, or EXPIRED by the worker. Every POST /bookings needs an Idempotency-Key.',
      )
      .setVersion('0.1.0')
      .addTag('resources', 'Rooms, desk pools and their availability')
      .addTag('bookings', 'Holds, confirmations, cancellations')
      .addTag('payments', 'Webhooks from the payment provider')
      .addTag('fake-psp', 'The in-repo payment provider, for demos and tests')
      .addTag('meta', 'Health and the active strategy')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<Config>(CONFIG);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
