import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FakePaymentProvider, SignedEvent } from '../../src/payments/fake.provider';
import { PAYMENT_PROVIDER } from '../../src/payments/payment.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './harness';

const SLOT = { startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };

let app: NestFastifyApplication;
let psp: FakePaymentProvider;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  psp = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
  prisma = app.get(PrismaService);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
});

async function hold(resourceId = 'room-1', slot = SLOT, userId = 'alice') {
  const response = await app.inject({
    method: 'POST',
    url: '/bookings',
    headers: {
      'idempotency-key': `${userId}-${resourceId}-${slot.startsAt}-${Math.random()}`,
      'x-user-id': userId,
    },
    payload: { resourceId, ...slot },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    id: string;
    amountCents: number;
    payment: { id: string; provider: string; clientSecret: string };
  }>();
}

function deliver(event: SignedEvent) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/payments',
    headers: { 'content-type': 'application/json', 'stripe-signature': event.signature },
    payload: event.payload,
  });
}

const status = async (id: string) =>
  (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe('POST /bookings creates a payment intent', () => {
  it('returns the intent and the pro-rated amount', async () => {
    const booking = await hold();
    expect(booking.payment).toMatchObject({
      provider: 'fake',
      id: expect.stringMatching(/^pi_fake_/),
    });
    expect(booking.amountCents).toBe(2500);
    const half = await hold('room-2', {
      startsAt: SLOT.startsAt,
      endsAt: '2026-10-01T09:30:00.000Z',
    });
    expect(half.amountCents).toBe(1250);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
      paymentId: booking.payment.id,
    });
  });

  it('releases the hold and the idempotency key when the provider fails, so a retry can reserve again', async () => {
    const original = psp.createIntent.bind(psp);
    psp.createIntent = () => Promise.reject(new Error('psp down'));
    const headers = { 'idempotency-key': 'k-psp', 'x-user-id': 'alice' };
    try {
      const failed = await app.inject({
        method: 'POST',
        url: '/bookings',
        headers,
        payload: { resourceId: 'room-1', ...SLOT },
      });
      expect(failed.statusCode).toBe(502);
      expect(failed.json()).toMatchObject({ code: 'payment_provider_unavailable' });
      expect(await prisma.booking.count({ where: { status: 'HELD' } })).toBe(0);
    } finally {
      psp.createIntent = original;
    }
    const retry = await app.inject({
      method: 'POST',
      url: '/bookings',
      headers,
      payload: { resourceId: 'room-1', ...SLOT },
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBeUndefined();
  });
});

describe('POST /webhooks/payments', () => {
  it("confirms a hold when the events arrive in Stripe's order", async () => {
    const booking = await hold();
    const events = await psp.pay(booking.payment.id, 'succeeded');
    const outcomes: string[] = [];
    for (const event of events) {
      const response = await deliver(event);
      expect(response.statusCode).toBe(200);
      outcomes.push(response.json().outcome);
    }
    expect(outcomes).toEqual(['IGNORED', 'IGNORED', 'APPLIED']);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CONFIRMED');
    expect(row.holdExpiresAt).toBeNull();
    expect(row.paymentLastEventAt?.toISOString()).toBe(events[2]?.createdAt.toISOString());
  });

  it('converges on the same state when the events arrive reversed, and a late cancel is stale', async () => {
    const booking = await hold();
    const [created, processing, succeeded] = await psp.pay(booking.payment.id, 'succeeded');
    if (!created || !processing || !succeeded) throw new Error('events');
    expect((await deliver(succeeded)).json()).toMatchObject({
      outcome: 'APPLIED',
      status: 'CONFIRMED',
    });
    expect((await deliver(processing)).json()).toMatchObject({ outcome: 'IGNORED' });
    expect((await deliver(created)).json()).toMatchObject({ outcome: 'IGNORED' });
    // a cancel older than the success we applied
    const staleCancel = psp.sign(
      booking.payment.id,
      'payment_intent.canceled',
      Math.floor(succeeded.createdAt.getTime() / 1000) - 1,
    );
    expect((await deliver(staleCancel)).json()).toMatchObject({
      outcome: 'STALE',
      status: 'CONFIRMED',
    });
    // and one newer than it: CONFIRMED is terminal for payments
    const lateCancel = psp.sign(
      booking.payment.id,
      'payment_intent.canceled',
      Math.floor(succeeded.createdAt.getTime() / 1000) + 60,
    );
    expect((await deliver(lateCancel)).json()).toMatchObject({
      outcome: 'STALE',
      status: 'CONFIRMED',
    });
    expect(await status(booking.id)).toBe('CONFIRMED');
  });

  it('records a redelivered event as DUPLICATE, also when the redeliveries race', async () => {
    const booking = await hold();
    const [, , succeeded] = await psp.pay(booking.payment.id, 'succeeded');
    if (!succeeded) throw new Error('events');
    const responses = await Promise.all(Array.from({ length: 10 }, () => deliver(succeeded)));
    const outcomes = responses.map((r) => r.json().outcome).sort();
    expect(outcomes.filter((o) => o === 'APPLIED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(9);
    expect((await deliver(succeeded)).json()).toMatchObject({ outcome: 'DUPLICATE' });
    expect(await prisma.paymentEvent.count({ where: { paymentId: booking.payment.id } })).toBe(1);
  });

  it('converges when whole sequences are delivered concurrently and shuffled', async () => {
    const booking = await hold();
    const events = await psp.pay(booking.payment.id, 'succeeded');
    const shuffled = [...events, ...events, ...events].sort(() => Math.random() - 0.5);
    const responses = await Promise.all(shuffled.map((e) => deliver(e)));
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    const outcomes = responses.map((r) => r.json().outcome);
    expect(outcomes.filter((o) => o === 'APPLIED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(6);
    expect(await status(booking.id)).toBe('CONFIRMED');
  });

  it('cancels a hold on payment_intent.canceled and frees the seat', async () => {
    const booking = await hold();
    const [, , canceled] = await psp.pay(booking.payment.id, 'canceled');
    if (!canceled) throw new Error('events');
    expect((await deliver(canceled)).json()).toMatchObject({
      outcome: 'APPLIED',
      status: 'CANCELLED',
    });
    const again = await hold('room-1', SLOT, 'bob');
    expect(again.id).not.toBe(booking.id);
  });

  it('marks money for a booking that no longer holds its seat as ORPHANED', async () => {
    const booking = await hold();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    const [, , succeeded] = await psp.pay(booking.payment.id, 'succeeded');
    if (!succeeded) throw new Error('events');
    expect((await deliver(succeeded)).json()).toMatchObject({
      outcome: 'ORPHANED',
      status: 'EXPIRED',
    });
    expect(await status(booking.id)).toBe('EXPIRED');
    expect(
      await prisma.paymentEvent.findUniqueOrThrow({ where: { id: succeeded.id } }),
    ).toMatchObject({ outcome: 'ORPHANED' });
  });

  it('answers 200 UNKNOWN for a payment it never created, and 400 for a bad signature', async () => {
    const stranger = psp.sign('pi_stranger', 'payment_intent.succeeded', 1_800_000_000);
    expect((await deliver(stranger)).json()).toMatchObject({ outcome: 'UNKNOWN' });
    const tampered = await deliver({
      ...stranger,
      payload: stranger.payload.replace('pi_stranger', 'pi_forged'),
    });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json()).toMatchObject({ code: 'invalid_signature' });
    const unsigned = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'content-type': 'application/json' },
      payload: stranger.payload,
    });
    expect(unsigned.statusCode).toBe(400);
    expect(await prisma.paymentEvent.count()).toBe(1);
  });
});

describe('POST /fake-psp/payments/:id/pay', () => {
  it('delivers the shuffled, duplicated sequence through the webhook path and the booking ends CONFIRMED', async () => {
    const booking = await hold();
    const response = await app.inject({
      method: 'POST',
      url: `/fake-psp/payments/${booking.payment.id}/pay`,
      payload: { order: 'shuffled', duplicate: true },
    });
    expect(response.statusCode).toBe(200);
    const { delivered } = response.json<{ delivered: { type: string; outcome: string }[] }>();
    expect(delivered).toHaveLength(4);
    expect(delivered.filter((d) => d.outcome === 'APPLIED')).toHaveLength(1);
    expect(delivered.filter((d) => d.outcome === 'DUPLICATE')).toHaveLength(1);
    expect(await status(booking.id)).toBe('CONFIRMED');
  });

  it('can cancel instead', async () => {
    const booking = await hold();
    await app.inject({
      method: 'POST',
      url: `/fake-psp/payments/${booking.payment.id}/pay`,
      payload: { outcome: 'canceled', order: 'stripe', duplicate: false },
    });
    expect(await status(booking.id)).toBe('CANCELLED');
  });
});
