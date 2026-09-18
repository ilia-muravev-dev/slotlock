import type { BookingStatus } from '../generated/prisma/enums';

export type PaymentSignal = 'succeeded' | 'canceled';

export type PaymentDecision =
  | { outcome: 'APPLIED'; next: BookingStatus }
  | { outcome: 'STALE' | 'ORPHANED' | 'IGNORED' };

/** The Stripe event types that change a booking; everything else is recorded and ignored. */
export function signalOf(eventType: string): PaymentSignal | undefined {
  switch (eventType) {
    case 'payment_intent.succeeded':
      return 'succeeded';
    case 'payment_intent.canceled':
      return 'canceled';
    default:
      return undefined;
  }
}

/**
 * The booking's answer to a payment signal, given its current status. Money for a booking that is
 * no longer holding its seat is ORPHANED (it has to be refunded, not seated); a signal that cannot
 * move the booking is STALE — CONFIRMED is terminal for payments.
 */
export function onPayment(status: BookingStatus, signal: PaymentSignal): PaymentDecision {
  switch (status) {
    case 'HELD':
      return { outcome: 'APPLIED', next: signal === 'succeeded' ? 'CONFIRMED' : 'CANCELLED' };
    case 'CONFIRMED':
      return { outcome: 'STALE' };
    case 'CANCELLED':
    case 'EXPIRED':
      return signal === 'succeeded' ? { outcome: 'ORPHANED' } : { outcome: 'STALE' };
  }
}
