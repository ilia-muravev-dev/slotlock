import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inject } from 'vitest';
import { seed } from '../../prisma/seed';
import { type Config, loadConfig } from '../../src/config';
import { createApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createWorker } from '../../src/worker';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    ...overrides,
  });
}

/** A booted application against the shared test containers, with `inject` for requests. */
export async function createTestApp(
  overrides: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const app = await createApp(testConfig(overrides));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** The worker process, booted in-process against the same containers. */
export async function createTestWorker(
  overrides: Record<string, string> = {},
): Promise<INestApplicationContext> {
  const worker = await createWorker(testConfig(overrides));
  await worker.init();
  return worker;
}

/** Empties every table and re-seeds the resources — call in beforeEach. */
export async function resetDatabase(app: NestFastifyApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE bookings, idempotency_keys, payment_events, outbox_events, processed_jobs, fake_payment_intents, resources RESTART IDENTITY CASCADE',
  );
  await seed(prisma);
}
