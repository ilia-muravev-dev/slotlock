import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inject } from 'vitest';
import { seed } from '../../prisma/seed';
import { loadConfig } from '../../src/config';
import { createApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';

/** A booted application against the shared test containers, with `inject` for requests. */
export async function createTestApp(
  overrides: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    ...overrides,
  });
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Empties every table and re-seeds the resources — call in beforeEach. */
export async function resetDatabase(app: NestFastifyApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE bookings, idempotency_keys, payment_events, outbox_events, processed_jobs, resources RESTART IDENTITY CASCADE',
  );
  await seed(prisma);
}
