import { describe, expect, it } from 'vitest';
import { onPayment, signalOf } from '../../src/bookings/booking.state';

describe('signalOf', () => {
  it('maps only the two Stripe events that move a booking', () => {
    expect(signalOf('payment_intent.succeeded')).toBe('succeeded');
    expect(signalOf('payment_intent.canceled')).toBe('canceled');
    expect(signalOf('payment_intent.payment_failed')).toBeUndefined(); // the customer may retry
    expect(signalOf('payment_intent.created')).toBeUndefined();
    expect(signalOf('charge.refunded')).toBeUndefined();
  });
});

describe('onPayment', () => {
  it.each([
    ['HELD', 'succeeded', { outcome: 'APPLIED', next: 'CONFIRMED' }],
    ['HELD', 'canceled', { outcome: 'APPLIED', next: 'CANCELLED' }],
    ['CONFIRMED', 'succeeded', { outcome: 'STALE' }],
    ['CONFIRMED', 'canceled', { outcome: 'STALE' }],
    ['CANCELLED', 'succeeded', { outcome: 'ORPHANED' }],
    ['CANCELLED', 'canceled', { outcome: 'STALE' }],
    ['EXPIRED', 'succeeded', { outcome: 'ORPHANED' }],
    ['EXPIRED', 'canceled', { outcome: 'STALE' }],
  ] as const)('%s + %s → %o', (status, signal, expected) => {
    expect(onPayment(status, signal)).toEqual(expected);
  });

  it('never leaves CONFIRMED and never confirms a booking that released its seat', () => {
    for (const signal of ['succeeded', 'canceled'] as const) {
      expect(onPayment('CONFIRMED', signal).outcome).toBe('STALE');
      for (const dead of ['CANCELLED', 'EXPIRED'] as const) {
        expect(onPayment(dead, signal).outcome).not.toBe('APPLIED');
      }
    }
  });
});
