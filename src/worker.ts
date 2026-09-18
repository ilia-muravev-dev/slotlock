// The worker process: BullMQ processors, the hold sweeper and (later) the outbox relay. Kept
// separate from the API so load on one does not starve the other.
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { Config } from './config';
import { WorkerModule } from './worker.module';

export async function createWorker(config?: Config): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createWorker();
  await app.init();
  app.get(Logger).log('worker ready');
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
