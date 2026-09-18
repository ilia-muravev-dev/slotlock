import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { CONFIG, type Config } from '../config';
import { PrismaClient } from '../generated/prisma/client';

/**
 * One Prisma client per process, on the pg driver adapter (Prisma 7 has no Rust engine). Under
 * contention many transactions queue for a connection or wait on a lock, so the interactive
 * transaction limits are well above Prisma's 2 s / 5 s defaults: a queued request should wait,
 * not fail.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(CONFIG) config: Config) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: config.DATABASE_POOL_SIZE,
      }),
      transactionOptions: { maxWait: 15_000, timeout: 30_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
