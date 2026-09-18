import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { InvalidSignatureError } from '../common/errors';
import type {
  CreateIntentInput,
  PaymentIntentRef,
  PaymentProvider,
  ProviderEvent,
} from './payment.provider';

/** Stripe PaymentIntents and signed webhooks; the only file that talks to Stripe's API. */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntentRef> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency,
      metadata: { bookingId: input.bookingId },
      automatic_payment_methods: { enabled: true },
    });
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async cancelIntent(paymentId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(paymentId);
  }

  constructEvent(rawBody: Buffer | string, signature: string | undefined): ProviderEvent {
    return parseStripeEvent(this.stripe, rawBody, signature, this.webhookSecret);
  }
}

/** Shared with the fake provider, which signs with the same scheme. */
export function parseStripeEvent(
  stripe: Stripe,
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): ProviderEvent {
  if (!signature) throw new InvalidSignatureError('missing Stripe-Signature header');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    throw new InvalidSignatureError(error instanceof Error ? error.message : String(error));
  }
  const object = event.data.object as { id?: unknown; object?: unknown };
  return {
    id: event.id,
    type: event.type,
    paymentId:
      object.object === 'payment_intent' && typeof object.id === 'string' ? object.id : undefined,
    createdAt: new Date(event.created * 1000),
  };
}
