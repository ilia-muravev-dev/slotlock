import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXCLUSION_CONSTRAINT } from '../../src/bookings/strategies/exclusion.strategy';
import { SAFE_STRATEGIES, type Strategy } from '../../src/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './harness';

const SLOT = { startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };

function book(app: NestFastifyApplication, resourceId: string, n: number, slot = SLOT) {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/bookings',
        headers: {
          'idempotency-key': `race-${resourceId}-${i}-${Math.random()}`,
          'x-user-id': `user-${i}`,
        },
        payload: { resourceId, ...slot },
      }),
    ),
  );
}

async function activeBookings(app: NestFastifyApplication, resourceId: string): Promise<number> {
  return app
    .get(PrismaService)
    .booking.count({ where: { resourceId, status: { in: ['HELD', 'CONFIRMED'] } } });
}

async function constraintExists(app: NestFastifyApplication): Promise<boolean> {
  const rows = await app.get(PrismaService).$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_constraint WHERE conname = ${EXCLUSION_CONSTRAINT}`;
  return Number(rows[0]?.n ?? 0) === 1;
}

describe.each(SAFE_STRATEGIES as Strategy[])('POST /bookings under the %s strategy', (strategy) => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ BOOKING_STRATEGY: strategy });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('reports the strategy on /health and owns the exclusion constraint only when it is the one', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      strategy,
    });
    expect(await constraintExists(app)).toBe(strategy === 'exclusion');
  });

  it('holds a room once: 50 concurrent requests for one slot → 1 × 201, 49 × 409, one row', async () => {
    const responses = await book(app, 'room-1', 50);
    const codes = responses.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(49);
    expect(responses.find((r) => r.statusCode === 409)?.json()).toMatchObject({
      code: 'no_capacity',
    });
    expect(responses.find((r) => r.statusCode === 201)?.json()).toMatchObject({
      resourceId: 'room-1',
      status: 'HELD',
      ...SLOT,
    });
    expect(await activeBookings(app, 'room-1')).toBe(1);
  });

  it('fills a pool exactly to capacity: 20 concurrent requests on a pool of 3 → 3 × 201', async () => {
    const responses = await book(app, 'pool-quiet', 20);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(17);
    expect(await activeBookings(app, 'pool-quiet')).toBe(3);
  });

  it('treats slots as half-open intervals: back-to-back bookings do not collide, overlapping ones do', async () => {
    const first = await book(app, 'room-2', 1, SLOT);
    const adjacent = await book(app, 'room-2', 1, {
      startsAt: SLOT.endsAt,
      endsAt: '2026-10-01T11:00:00.000Z',
    });
    const overlapping = await book(app, 'room-2', 1, {
      startsAt: '2026-10-01T09:30:00.000Z',
      endsAt: '2026-10-01T10:30:00.000Z',
    });
    expect([first[0]?.statusCode, adjacent[0]?.statusCode, overlapping[0]?.statusCode]).toEqual([
      201, 201, 409,
    ]);
    expect(await activeBookings(app, 'room-2')).toBe(2);
  });

  it('ignores cancelled bookings when counting capacity', async () => {
    const [held] = await book(app, 'room-3', 1);
    await app
      .get(PrismaService)
      .booking.update({ where: { id: held?.json().id }, data: { status: 'CANCELLED' } });
    expect((await book(app, 'room-3', 1))[0]?.statusCode).toBe(201);
  });
});

describe('POST /bookings under the naive control', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ BOOKING_STRATEGY: 'naive' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('double-books — the race is real, which is what the five strategies are for', async () => {
    let worst = 0;
    for (let round = 0; round < 5 && worst < 2; round += 1) {
      await resetDatabase(app);
      await book(app, 'room-1', 50);
      worst = Math.max(worst, await activeBookings(app, 'room-1'));
    }
    expect(worst).toBeGreaterThan(1);
  });
});
