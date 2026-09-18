import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { IdempotencyMismatchError, PG, pgCode, RequestInFlightError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export const KEY_TTL_MS = 24 * 60 * 60 * 1000;

export type Claim = { kind: 'fresh' } | { kind: 'replay'; status: number; body: unknown };

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function requestHash(userId: string, method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([userId, method.toUpperCase(), path, body ?? null]))
    .digest('hex');
}

/**
 * Idempotency keys are scoped to the user. A key is claimed IN_FLIGHT before the handler runs;
 * a concurrent claim of the same key gets 409; a finished key replays its stored response when
 * the request hash matches and 422 when it does not.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  scopedKey(userId: string, key: string): string {
    return `${userId}:${key}`;
  }

  async claim(userId: string, key: string, hash: string, now = new Date()): Promise<Claim> {
    const scoped = this.scopedKey(userId, key);
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: scoped,
          userId,
          requestHash: hash,
          expiresAt: new Date(now.getTime() + KEY_TTL_MS),
        },
      });
      return { kind: 'fresh' };
    } catch (error) {
      if (pgCode(error) !== PG.uniqueViolation && (error as { code?: string }).code !== 'P2002')
        throw error;
    }
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: scoped } });
    if (!existing) return this.claim(userId, key, hash, now); // deleted between our insert and read
    if (existing.expiresAt <= now) {
      await this.prisma.idempotencyKey.deleteMany({
        where: { key: scoped, expiresAt: { lte: now } },
      });
      return this.claim(userId, key, hash, now);
    }
    if (existing.requestHash !== hash) throw new IdempotencyMismatchError(key);
    if (existing.status === 'IN_FLIGHT') throw new RequestInFlightError(key);
    return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
  }

  async complete(userId: string, key: string, response: StoredResponse): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key: this.scopedKey(userId, key) },
      data: {
        status: 'DONE',
        responseStatus: response.status,
        responseBody: response.body as object,
      },
    });
  }

  /** A 5xx or a crash must not poison the key: release it so the client can retry. */
  async release(userId: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { key: this.scopedKey(userId, key) } });
  }
}
