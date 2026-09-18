import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './harness';

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

describe('GET /resources', () => {
  it('lists the seeded rooms and pools', async () => {
    const response = await app.inject({ method: 'GET', url: '/resources' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id: string; kind: string; capacity: number }[]>();
    expect(body.map((r) => r.id)).toEqual([
      'pool-hot-desks',
      'pool-quiet',
      'room-1',
      'room-2',
      'room-3',
      'room-4',
      'room-5',
    ]);
    expect(body.find((r) => r.id === 'pool-quiet')).toMatchObject({
      kind: 'DESK_POOL',
      capacity: 3,
    });
  });

  it('404s an unknown resource', async () => {
    expect((await app.inject({ method: 'GET', url: '/resources/nope' })).statusCode).toBe(404);
  });
});

describe('GET /resources/:id/availability', () => {
  it('counts active bookings per slot and ignores cancelled ones', async () => {
    const prisma = app.get(PrismaService);
    const day = '2026-10-01';
    await prisma.booking.createMany({
      data: [
        {
          resourceId: 'pool-quiet',
          userId: 'u1',
          startsAt: new Date(`${day}T09:00:00Z`),
          endsAt: new Date(`${day}T11:00:00Z`),
          exclusive: false,
          status: 'CONFIRMED',
        },
        {
          resourceId: 'pool-quiet',
          userId: 'u2',
          startsAt: new Date(`${day}T10:00:00Z`),
          endsAt: new Date(`${day}T10:30:00Z`),
          exclusive: false,
          status: 'HELD',
        },
        {
          resourceId: 'pool-quiet',
          userId: 'u3',
          startsAt: new Date(`${day}T10:00:00Z`),
          endsAt: new Date(`${day}T12:00:00Z`),
          exclusive: false,
          status: 'CANCELLED',
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/resources/pool-quiet/availability?from=${day}T08:00:00Z&to=${day}T12:00:00Z&slot=60`,
    });
    expect(response.statusCode).toBe(200);
    const slots =
      response.json<{ startsAt: string; booked: number; available: number; capacity: number }[]>();
    expect(slots.map((s) => [s.startsAt.slice(11, 16), s.booked, s.available])).toEqual([
      ['08:00', 0, 3],
      ['09:00', 1, 2],
      ['10:00', 2, 1],
      ['11:00', 0, 3],
    ]);
    expect(slots[0]?.capacity).toBe(3);
  });

  it('validates the window', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/resources/room-1/availability?from=2026-10-01T10:00:00Z&to=2026-10-01T09:00:00Z',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ issues: { path: string }[] }>().issues[0]?.path).toBe('to');
    const wide = await app.inject({
      method: 'GET',
      url: '/resources/room-1/availability?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z',
    });
    expect(wide.statusCode).toBe(400);
  });
});
