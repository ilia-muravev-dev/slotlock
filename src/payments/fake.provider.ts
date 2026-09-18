import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
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
 * An in-process PSP: intents live in memory and "paying" produces Stripe-shaped events signed
 * with the real Stripe scheme (so the webhook endpoint runs the same verification either way).
 * The events come with the timestamps Stripe would give them; delivering them shuffled and
 * duplicated is the caller's job — that is the point of the exercise.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  private readonly stripe = new Stripe('sk_test_slotlock_fake');
  private readonly intents = new Map<
    string,
    { bookingId: string; amountCents: number; status: string }
  >();

  constructor(private readonly webhookSecret: string) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntentRef> {
    const id = `pi_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    this.intents.set(id, {
      bookingId: input.bookingId,
      amountCents: input.amountCents,
      status: 'requires_payment_method',
    });
    return { id, clientSecret: `${id}_secret_fake` };
  }

  async cancelIntent(paymentId: string): Promise<void> {
    const intent = this.intents.get(paymentId);
    if (intent) intent.status = 'canceled';
  }

  constructEvent(rawBody: Buffer | string, signature: string | undefined): ProviderEvent {
    return parseStripeEvent(this.stripe, rawBody, signature, this.webhookSecret);
  }

  /**
   * What Stripe would send for a payment attempt, in the order it would create them:
   * `payment_intent.created` at t, `payment_intent.processing` at t+1 s, then the outcome at t+2 s.
   */
  pay(paymentId: string, outcome: FakeOutcome, at = new Date()): SignedEvent[] {
    const intent = this.intents.get(paymentId);
    if (intent) intent.status = outcome;
    const t = Math.floor(at.getTime() / 1000);
    return [
      this.sign(paymentId, 'payment_intent.created', t),
      this.sign(paymentId, 'payment_intent.processing', t + 1),
      this.sign(paymentId, `payment_intent.${outcome}`, t + 2),
    ];
  }

  /** One signed event of any type — tests use it for stale, unknown and malformed cases. */
  sign(
    paymentId: string,
    type: string,
    createdSeconds: number,
    id = `evt_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  ): SignedEvent {
    const intent = this.intents.get(paymentId);
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
          amount: intent?.amountCents ?? 0,
          currency: 'usd',
          status: type.replace('payment_intent.', ''),
          metadata: intent ? { bookingId: intent.bookingId } : {},
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
