import { describe, expect, it } from 'vitest';
import { FakePaymentProvider } from '../../src/payments/fake.provider';

const SECRET = 'whsec_test_secret';

/** Just enough of PrismaService for the fake PSP's intents. */
function memoryPrisma() {
  const rows = new Map<
    string,
    { id: string; bookingId: string; amountCents: number; status: string }
  >();
  return {
    fakePaymentIntent: {
      create: async ({
        data,
      }: {
        data: { id: string; bookingId: string; amountCents: number; status: string };
      }) => {
        rows.set(data.id, { ...data });
        return data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const row = rows.get(where.id);
        if (row) row.status = data.status;
        return row;
      },
    },
  } as never;
}

describe('FakePaymentProvider', () => {
  it('creates intents and produces the three events Stripe would, in order, a second apart', async () => {
    const psp = new FakePaymentProvider(memoryPrisma(), SECRET);
    const intent = await psp.createIntent({ bookingId: 'b1', amountCents: 2500, currency: 'usd' });
    expect(intent.id).toMatch(/^pi_fake_/);
    expect(intent.clientSecret).toContain('_secret_');
    const events = await psp.pay(intent.id, 'succeeded', new Date('2026-10-01T09:00:00Z'));
    expect(events.map((e) => e.type)).toEqual([
      'payment_intent.created',
      'payment_intent.processing',
      'payment_intent.succeeded',
    ]);
    expect(events.map((e) => e.createdAt.toISOString())).toEqual([
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T09:00:01.000Z',
      '2026-10-01T09:00:02.000Z',
    ]);
  });

  it('signs with the Stripe scheme, so the same verification accepts it and rejects tampering', async () => {
    const psp = new FakePaymentProvider(memoryPrisma(), SECRET);
    const intent = await psp.createIntent({ bookingId: 'b1', amountCents: 2500, currency: 'usd' });
    const [event] = await psp.pay(intent.id, 'succeeded');
    if (!event) throw new Error('no event');
    const parsed = psp.constructEvent(event.payload, event.signature);
    expect(parsed).toMatchObject({
      id: event.id,
      type: 'payment_intent.created',
      paymentId: intent.id,
    });
    expect(() =>
      psp.constructEvent(event.payload.replace(intent.id, 'pi_other'), event.signature),
    ).toThrow(/signature/);
    expect(() => psp.constructEvent(event.payload, undefined)).toThrow(/signature/);
    expect(() =>
      new FakePaymentProvider(memoryPrisma(), 'whsec_other').constructEvent(
        event.payload,
        event.signature,
      ),
    ).toThrow(/signature/);
  });
});
