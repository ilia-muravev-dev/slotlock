import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyService, KEY_TTL_MS } from '../../src/idempotency/idempotency.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './harness';

const SLOT = { startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };
const body = (resourceId = 'room-1') => ({ resourceId, ...SLOT });

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
});

function post(key: string | undefined, payload: Record<string, unknown>, userId = 'alice') {
  const headers: Record<string, string> = { 'x-user-id': userId };
  if (key !== undefined) headers['idempotency-key'] = key;
  return app.inject({ method: 'POST', url: '/bookings', headers, payload });
}

describe('Idempotency-Key on POST /bookings', () => {
  it('is required, as is the user', async () => {
    expect((await post(undefined, body())).json()).toMatchObject({
      code: 'idempotency_key_required',
    });
    const noUser = await app.inject({
      method: 'POST',
      url: '/bookings',
      headers: { 'idempotency-key': 'k' },
      payload: body(),
    });
    expect(noUser.statusCode).toBe(400);
    expect(noUser.json()).toMatchObject({ code: 'user_required' });
  });

  it('replays the stored response for a retry with the same key and body, creating no second booking', async () => {
    const first = await post('k1', body());
    const retry = await post('k1', body());
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(retry.json()).toEqual(first.json());
    expect(await app.get(PrismaService).booking.count()).toBe(1);
  });

  it('replays a stored 409 too — a retry of a lost race stays lost', async () => {
    await post('winner', body(), 'bob');
    const lost = await post('k2', body());
    const retry = await post('k2', body());
    expect(lost.statusCode).toBe(409);
    expect(retry.statusCode).toBe(409);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.json()).toMatchObject({ code: 'no_capacity' });
  });

  it('answers 422 when the same key arrives with a different body', async () => {
    await post('k3', body('room-1'));
    const reused = await post('k3', body('room-2'));
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'idempotency_key_reused' });
    expect(await app.get(PrismaService).booking.count()).toBe(1);
  });

  it('answers 409 request_in_flight to duplicates while the first request is still running, then replays it', async () => {
    const prisma = app.get(PrismaService);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = prisma.resource.findUnique.bind(prisma.resource);
    prisma.resource.findUnique = (async (...args: Parameters<typeof original>) => {
      await gate;
      return original(...args);
    }) as never;
    try {
      const first = post('k4', body());
      await vi.waitFor(async () => {
        expect(await prisma.idempotencyKey.count({ where: { status: 'IN_FLIGHT' } })).toBe(1);
      });
      const duplicates = await Promise.all(Array.from({ length: 9 }, () => post('k4', body())));
      expect(duplicates.map((r) => r.statusCode)).toEqual(Array(9).fill(409));
      expect(duplicates[0]?.json()).toMatchObject({ code: 'request_in_flight' });
      release();
      expect((await first).statusCode).toBe(201);
    } finally {
      release();
      prisma.resource.findUnique = original as never;
    }
    const retry = await post('k4', body());
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(await prisma.booking.count()).toBe(1);
  });

  it('scopes keys per user: two users may reuse the same key', async () => {
    const alice = await post('shared', body('room-1'), 'alice');
    const bob = await post('shared', body('room-2'), 'bob');
    expect([alice.statusCode, bob.statusCode]).toEqual([201, 201]);
    expect(await app.get(PrismaService).booking.count()).toBe(2);
  });

  it('releases the key when the handler fails with a 5xx so the client can retry', async () => {
    const idempotency = app.get(IdempotencyService);
    const prisma = app.get(PrismaService);
    const original = prisma.resource.findUnique.bind(prisma.resource);
    prisma.resource.findUnique = (() => Promise.reject(new Error('database went away'))) as never;
    try {
      expect((await post('k5', body())).statusCode).toBe(500);
    } finally {
      prisma.resource.findUnique = original as never;
    }
    expect(
      await prisma.idempotencyKey.findUnique({
        where: { key: idempotency.scopedKey('alice', 'k5') },
      }),
    ).toBeNull();
    expect((await post('k5', body())).statusCode).toBe(201);
  });

  it('forgets a key after its TTL', async () => {
    const prisma = app.get(PrismaService);
    await post('k6', body('room-1'));
    await prisma.idempotencyKey.updateMany({
      data: { expiresAt: new Date(Date.now() - KEY_TTL_MS) },
    });
    const later = await post('k6', body('room-2'));
    expect(later.statusCode).toBe(201);
    expect(later.headers['idempotency-replayed']).toBeUndefined();
  });

  it('does not treat a 4xx handler result as a poisoned key: validation errors are stored and replayed', async () => {
    const bad = await post('k7', {
      resourceId: 'room-1',
      startsAt: SLOT.endsAt,
      endsAt: SLOT.startsAt,
    });
    const retry = await post('k7', {
      resourceId: 'room-1',
      startsAt: SLOT.endsAt,
      endsAt: SLOT.startsAt,
    });
    expect(bad.statusCode).toBe(400);
    expect(retry.statusCode).toBe(400);
    expect(retry.headers['idempotency-replayed']).toBe('true');
  });
});
