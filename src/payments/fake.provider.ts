import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  CreateIntentInput,
  PaymentIntentRef,
  PaymentProvider,
  ProviderEvent,
} from './payment.provider';
import { parseStripeEvent } from './stripe.provider';

export interface SignedEvent {
  /** The JSON body exactly as it must be delivered — the signature covers these bytes. */
  payload: string;
  signature: string;
  id: string;
  type: string;
  createdAt: Date;
}

export type FakeOutcome = 'succeeded' | 'canceled';

/**
 * An in-repo PSP: intents live in the database (the worker cancels what the API created) and
 * "paying" produces Stripe-shaped events signed with the real Stripe scheme, so the webhook
 * endpoint runs the same verification either way. The events carry the timestamps Stripe would
 * give them; delivering them shuffled and duplicated is the caller's job — that is the exercise.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  private readonly stripe = new Stripe('sk_test_slotlock_fake');

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookSecret: string,
  ) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntentRef> {
    const id = `pi_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await this.prisma.fakePaymentIntent.create({
      data: {
        id,
        bookingId: input.bookingId,
        amountCents: input.amountCents,
        status: 'requires_payment_method',
      },
    });
    return { id, clientSecret: `${id}_secret_fake` };
  }

  /** Like Stripe, refuses to cancel an intent that already succeeded. */
  async cancelIntent(paymentId: string): Promise<void> {
    const intent = await this.prisma.fakePaymentIntent.findUnique({ where: { id: paymentId } });
    if (!intent) throw new Error(`no such payment intent ${paymentId}`);
    if (intent.status === 'succeeded') {
      throw new Error('a succeeded payment intent cannot be canceled');
    }
    await this.prisma.fakePaymentIntent.update({
      where: { id: paymentId },
      data: { status: 'canceled' },
    });
  }

  async intentStatus(paymentId: string): Promise<string | undefined> {
    const intent = await this.prisma.fakePaymentIntent.findUnique({ where: { id: paymentId } });
    return intent?.status;
  }

  constructEvent(rawBody: Buffer | string, signature: string | undefined): ProviderEvent {
    return parseStripeEvent(this.stripe, rawBody, signature, this.webhookSecret);
  }

  /**
   * What Stripe would send for a payment attempt, in the order it would create them:
   * `payment_intent.created` at t, `payment_intent.processing` at t+1 s, then the outcome at t+2 s.
   */
  async pay(paymentId: string, outcome: FakeOutcome, at = new Date()): Promise<SignedEvent[]> {
    const intent = await this.prisma.fakePaymentIntent.findUnique({ where: { id: paymentId } });
    if (intent) {
      await this.prisma.fakePaymentIntent.update({
        where: { id: paymentId },
        data: { status: outcome },
      });
    }
    const t = Math.floor(at.getTime() / 1000);
    const meta = intent
      ? { amountCents: intent.amountCents, bookingId: intent.bookingId }
      : undefined;
    return [
      this.sign(paymentId, 'payment_intent.created', t, undefined, meta),
      this.sign(paymentId, 'payment_intent.processing', t + 1, undefined, meta),
      this.sign(paymentId, `payment_intent.${outcome}`, t + 2, undefined, meta),
    ];
  }

  /** One signed event of any type — tests use it for stale, unknown and malformed cases. */
  sign(
    paymentId: string,
    type: string,
    createdSeconds: number,
    id = `evt_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    meta?: { amountCents: number; bookingId: string },
  ): SignedEvent {
    const payload = JSON.stringify({
      id,
      object: 'event',
      type,
      created: createdSeconds,
      livemode: false,
      data: {
        object: {
          id: paymentId,
          object: 'payment_intent',
          amount: meta?.amountCents ?? 0,
          currency: 'usd',
          status: type.replace('payment_intent.', ''),
          metadata: meta ? { bookingId: meta.bookingId } : {},
        },
      },
    });
    const signature = this.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: this.webhookSecret,
    });
    return { payload, signature, id, type, createdAt: new Date(createdSeconds * 1000) };
  }
}
