/** What a payment service provider has to offer for a hold to be paid and confirmed. */
export interface PaymentProvider {
  readonly name: 'stripe' | 'fake';
  createIntent(input: CreateIntentInput): Promise<PaymentIntentRef>;
  cancelIntent(paymentId: string): Promise<void>;
  /** Verifies the signature and parses the raw webhook body; throws InvalidSignatureError. */
  constructEvent(rawBody: Buffer | string, signature: string | undefined): ProviderEvent;
}

export interface CreateIntentInput {
  bookingId: string;
  amountCents: number;
  currency: string;
}

export interface PaymentIntentRef {
  id: string;
  clientSecret: string | null;
}

/** The subset of a PSP event that ordering and the state machine need; `raw` for the log. */
export interface ProviderEvent {
  id: string;
  type: string;
  paymentId: string | undefined;
  createdAt: Date;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
