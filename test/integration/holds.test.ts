import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expireJobId, SWEEPER_ID } from '../../src/bookings/holds/hold.scheduler';
import { HoldExpiryService } from '../../src/bookings/holds/hold-expiry.service';
import type { FakePaymentProvider } from '../../src/payments/fake.provider';
import { PAYMENT_PROVIDER } from '../../src/payments/payment.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HOLDS_QUEUE } from '../../src/queue/queue.module';
import { createTestApp, createTestWorker, resetDatabase } from './harness';

const SLOT = { startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };

let app: NestFastifyApplication;
let worker: INestApplicationContext;
let prisma: PrismaService;
let psp: FakePaymentProvider;
let queue: Queue;

beforeAll(async () => {
  app = await createTestApp({ HOLD_TTL_SECONDS: '1', HOLD_SWEEP_INTERVAL_MS: '600000' });
  worker = await createTestWorker({ HOLD_TTL_SECONDS: '1', HOLD_SWEEP_INTERVAL_MS: '600000' });
  prisma = app.get(PrismaService);
  psp = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
  queue = app.get<Queue>(getQueueToken(HOLDS_QUEUE));
});
afterAll(async () => {
  await worker.close();
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
  await queue.drain(true);
});

async function hold(resourceId = 'room-1', userId = 'alice', slot = SLOT) {
  const response = await app.inject({
    method: 'POST',
    url: '/bookings',
    headers: { 'idempotency-key': `${userId}-${resourceId}-${Math.random()}`, 'x-user-id': userId },
    payload: { resourceId, ...slot },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; holdExpiresAt: string; payment: { id: string } }>();
}

const status = async (id: string) =>
  (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe('hold expiry', () => {
  it('expires an unpaid hold after the TTL through the delayed job, cancels the intent and frees the seat', async () => {
    const booking = await hold();
    expect(new Date(booking.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await queue.getJob(expireJobId(booking.id))).toBeTruthy();
    await vi.waitFor(async () => expect(await status(booking.id)).toBe('EXPIRED'), {
      timeout: 10_000,
      interval: 100,
    });
    // the intent is cancelled after the row is committed, so give it a moment
    await vi.waitFor(async () =>
      expect(await psp.intentStatus(booking.payment.id)).toBe('canceled'),
    );
    const again = await hold('room-1', 'bob');
    expect(again.id).not.toBe(booking.id);
  });

  it('leaves a hold alone once it is paid', async () => {
    const booking = await hold();
    await app.inject({
      method: 'POST',
      url: `/fake-psp/payments/${booking.payment.id}/pay`,
      payload: { order: 'stripe', duplicate: false },
    });
    expect(await status(booking.id)).toBe('CONFIRMED');
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(expireJobId(booking.id));
        expect(await job?.getState()).toBe('completed');
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(await status(booking.id)).toBe('CONFIRMED');
    expect(await psp.intentStatus(booking.payment.id)).toBe('succeeded');
  });

  it('is scheduled once per booking, even when the request is retried', async () => {
    const headers = { 'idempotency-key': 'k-hold', 'x-user-id': 'alice' };
    const first = await app.inject({
      method: 'POST',
      url: '/bookings',
      headers,
      payload: { resourceId: 'room-2', ...SLOT },
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/bookings',
      headers,
      payload: { resourceId: 'room-2', ...SLOT },
    });
    expect([first.statusCode, retry.statusCode]).toEqual([201, 201]);
    const delayed = await queue.getDelayed();
    expect(delayed.filter((j) => j.id === expireJobId(first.json().id))).toHaveLength(1);
  });
});

describe('the sweeper', () => {
  it('expires holds whose delayed job was lost, and nothing else', async () => {
    const lost = await prisma.booking.create({
      data: {
        resourceId: 'room-3',
        userId: 'carol',
        startsAt: SLOT.startsAt,
        endsAt: SLOT.endsAt,
        exclusive: true,
        status: 'HELD',
        holdExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const fresh = await prisma.booking.create({
      data: {
        resourceId: 'room-4',
        userId: 'carol',
        startsAt: SLOT.startsAt,
        endsAt: SLOT.endsAt,
        exclusive: true,
        status: 'HELD',
        holdExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const confirmed = await prisma.booking.create({
      data: {
        resourceId: 'room-5',
        userId: 'carol',
        startsAt: SLOT.startsAt,
        endsAt: SLOT.endsAt,
        exclusive: true,
        status: 'CONFIRMED',
        holdExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await worker.get(HoldExpiryService).sweep()).toBe(1);
    expect(await status(lost.id)).toBe('EXPIRED');
    expect(await status(fresh.id)).toBe('HELD');
    expect(await status(confirmed.id)).toBe('CONFIRMED');
    expect(await worker.get(HoldExpiryService).sweep()).toBe(0);
  });

  it('is registered as a repeatable job by the worker', async () => {
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key ?? s.id)).toContain(SWEEPER_ID);
  });

  it('works in batches larger than one', async () => {
    await prisma.booking.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        resourceId: 'pool-hot-desks',
        userId: `u${i}`,
        startsAt: SLOT.startsAt,
        endsAt: SLOT.endsAt,
        exclusive: false,
        status: 'HELD' as const,
        holdExpiresAt: new Date(Date.now() - 1000),
      })),
    });
    expect(await worker.get(HoldExpiryService).sweep(3)).toBe(7);
    expect(await prisma.booking.count({ where: { status: 'EXPIRED' } })).toBe(7);
  });
});

describe('DELETE /bookings/:id', () => {
  const cancel = (id: string, userId = 'alice') =>
    app.inject({ method: 'DELETE', url: `/bookings/${id}`, headers: { 'x-user-id': userId } });

  it('cancels a hold, cancels its intent and frees the seat', async () => {
    const booking = await hold();
    const response = await cancel(booking.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: booking.id, status: 'CANCELLED' });
    expect(await psp.intentStatus(booking.payment.id)).toBe('canceled');
    expect((await hold('room-1', 'bob')).id).not.toBe(booking.id);
  });

  it('cancels a confirmed booking too, and is idempotent', async () => {
    const booking = await hold();
    await app.inject({
      method: 'POST',
      url: `/fake-psp/payments/${booking.payment.id}/pay`,
      payload: { order: 'stripe', duplicate: false },
    });
    expect((await cancel(booking.id)).json()).toMatchObject({ status: 'CANCELLED' });
    expect((await cancel(booking.id)).statusCode).toBe(200);
    expect(await status(booking.id)).toBe('CANCELLED');
  });

  it('refuses another user, an unknown booking, an expired one, and a missing user header', async () => {
    const booking = await hold();
    expect((await cancel(booking.id, 'mallory')).statusCode).toBe(403);
    expect((await cancel('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    const expired = await cancel(booking.id);
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: 'invalid_transition' });
    expect(
      (await app.inject({ method: 'DELETE', url: `/bookings/${booking.id}` })).statusCode,
    ).toBe(400);
  });
});
