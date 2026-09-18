import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

/** One Postgres and one Redis for the whole integration run; migrations applied once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
  const redis = await new RedisContainer('redis:8-alpine').start();
  const databaseUrl = postgres.getConnectionUri();
  execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redis.getConnectionUrl());
  return async () => {
    await redis.stop();
    await postgres.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
