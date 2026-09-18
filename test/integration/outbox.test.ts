import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Job, Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldExpiryService } from '../../src/bookings/holds/hold-expiry.service';
import { NotificationSink } from '../../src/outbox/notification.sink';
import { NotificationsProcessor } from '../../src/outbox/notifications.processor';
import { OutboxRelay } from '../../src/outbox/outbox.relay';
import type { FakePaymentProvider } from '../../src/payments/fake.provider';
import { PAYMENT_PROVIDER } from '../../src/payments/payment.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NOTIFICATIONS_QUEUE, OUTBOX_QUEUE } from '../../src/queue/queue.module';
import { createTestApp, createTestWorker, resetDatabase } from './harness';

const SLOT = { startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };

let app: NestFastifyApplication;
let worker: INestApplicationContext;
let prisma: PrismaService;
let psp: FakePaymentProvider;
let notifications: Queue;
let sink: NotificationSink;
let relay: OutboxRelay;

beforeAll(async () => {
  // a slow relay tick: the tests drive the relay by hand where timing matters
  app = await createTestApp({
    OUTBOX_RELAY_INTERVAL_MS: '600000',
    HOLD_SWEEP_INTERVAL_MS: '600000',
  });
  worker = await createTestWorker({
    OUTBOX_RELAY_INTERVAL_MS: '600000',
    HOLD_SWEEP_INTERVAL_MS: '600000',
  });
  prisma = app.get(PrismaService);
  psp = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
  notifications = app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
  sink = worker.get(NotificationSink);
  relay = worker.get(OutboxRelay);
});
afterAll(async () => {
  await worker.close();
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
  await notifications.drain(true);
  await notifications.clean(0, 10_000, 'completed');
  await app.get<Queue>(getQueueToken(OUTBOX_QUEUE)).drain(true);
  sink.recent.length = 0;
});

async function hold(resourceId = 'room-1', userId = 'alice') {
  const response = await app.inject({
    method: 'POST',
    url: '/bookings',
    headers: { 'idempotency-key': `${userId}-${resourceId}-${Math.random()}`, 'x-user-id': userId },
    payload: { resourceId, ...SLOT },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; payment: { id: string } }>();
}

const outboxTypes = async (bookingId: string) =>
  (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }))
    .filter((e) => (e.payload as { bookingId?: string }).bookingId === bookingId)
    .map((e) => e.type);

const pay = (paymentId: string, outcome = 'succeeded') =>
  app.inject({
    method: 'POST',
    url: `/fake-psp/payments/${paymentId}/pay`,
    payload: { outcome, order: 'shuffled', duplicate: true },
  });

describe('the outbox', () => {
  it('records booking.held in the same transaction as the hold, unpublished', async () => {
    const booking = await hold();
    const [event] = await prisma.outboxEvent.findMany();
    expect(event).toMatchObject({
      type: 'booking.held',
      publishedAt: null,
      payload: { bookingId: booking.id, userId: 'alice', resourceId: 'room-1', amountCents: 2500 },
    });
  });

  it('announces every transition: confirmed, cancelled, expired, orphaned money, refunds', async () => {
    const confirmed = await hold('room-1');
    await pay(confirmed.payment.id);
    expect(await outboxTypes(confirmed.id)).toEqual(['booking.held', 'booking.confirmed']);

    const cancelledByPsp = await hold('room-2');
    await pay(cancelledByPsp.payment.id, 'canceled');
    expect(await outboxTypes(cancelledByPsp.id)).toEqual(['booking.held', 'booking.cancelled']);

    const cancelledByUser = await hold('room-3');
    await pay(cancelledByUser.payment.id);
    await app.inject({
      method: 'DELETE',
      url: `/bookings/${cancelledByUser.id}`,
      headers: { 'x-user-id': 'alice' },
    });
    expect(await outboxTypes(cancelledByUser.id)).toEqual([
      'booking.held',
      'booking.confirmed',
      'booking.cancelled',
      'payment.refund_requested',
    ]);

    const expired = await hold('room-4');
    await prisma.booking.update({
      where: { id: expired.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await worker.get(HoldExpiryService).expire(expired.id)).toBe('expired');
    await pay(expired.payment.id); // the customer paid an instant too late
    expect(await outboxTypes(expired.id)).toEqual([
      'booking.held',
      'booking.expired',
      'payment.orphaned',
    ]);
  });
});

describe('the relay', () => {
  it('publishes unpublished rows as jobs keyed by event id, oldest first, in batches', async () => {
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        type: 'booking.held',
        payload: { bookingId: `b${i}` },
        createdAt: new Date(Date.now() - 250_000 + i * 1000),
      })),
    });
    expect(await relay.relay(100)).toBe(250);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    await vi.waitFor(async () => expect(sink.recent).toHaveLength(250), { timeout: 15_000 });
    const events = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    // the consumer runs 10 jobs at a time, so delivery order is approximate: assert the set
    expect([...sink.recent.map((n) => n.id)].sort()).toEqual(events.map((e) => e.id).sort());
    expect(await relay.relay(100)).toBe(0);
  });

  it('offers a row again if its published mark was lost, and the queue ignores the repeat', async () => {
    const booking = await hold();
    expect(await relay.relay()).toBe(1);
    await vi.waitFor(async () => expect(sink.recent).toHaveLength(1));
    await prisma.outboxEvent.updateMany({ data: { publishedAt: null } }); // the crash between add and commit
    expect(await relay.relay()).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(sink.recent).toHaveLength(1);
    expect(sink.recent[0]).toMatchObject({
      type: 'booking.held',
      payload: { bookingId: booking.id },
    });
  });
});

describe('the notifications consumer', () => {
  it('delivers a job once and treats a redelivery as a duplicate', async () => {
    const processor = worker.get(NotificationsProcessor);
    const job = { id: 'evt-1', name: 'booking.held', data: { bookingId: 'b1' } } as unknown as Job;
    expect(await processor.process(job)).toBe('delivered');
    expect(await processor.process(job)).toBe('duplicate');
    expect(await processor.process({ ...job, id: 'evt-2' } as unknown as Job)).toBe('delivered');
    expect(sink.recent.map((n) => n.id)).toEqual(['evt-1', 'evt-2']);
    expect(await prisma.processedJob.count()).toBe(2);
  });

  it('does not claim a job whose delivery failed, so a retry delivers it', async () => {
    const processor = worker.get(NotificationsProcessor);
    const original = sink.deliver.bind(sink);
    sink.deliver = () => Promise.reject(new Error('mail server down'));
    const job = { id: 'evt-3', name: 'booking.held', data: { bookingId: 'b1' } } as unknown as Job;
    try {
      await expect(processor.process(job)).rejects.toThrow('mail server down');
    } finally {
      sink.deliver = original;
    }
    expect(await prisma.processedJob.count()).toBe(0);
    expect(await processor.process(job)).toBe('delivered');
  });

  it('end to end: a hold becomes a notification through relay and queue, exactly once under a duplicate delivery', async () => {
    const booking = await hold();
    await relay.relay();
    await vi.waitFor(async () => expect(sink.recent).toHaveLength(1));
    const [event] = await prisma.outboxEvent.findMany();
    if (!event) throw new Error('no event');
    // a second delivery of the same event, as a broker may do after a lost ack
    await vi.waitFor(async () => {
      const first = await notifications.getJob(event.id);
      expect(await first?.getState()).toBe('completed'); // delivered, lock released
      await first?.remove();
    });
    await notifications.add(event.type, event.payload, { jobId: event.id });
    await vi.waitFor(async () => {
      const job = await notifications.getJob(event.id);
      expect(await job?.getState()).toBe('completed');
      expect(await job?.returnvalue).toBe('duplicate');
    });
    expect(sink.recent).toHaveLength(1);
    expect(sink.recent[0]?.payload).toMatchObject({ bookingId: booking.id });
  });
});
