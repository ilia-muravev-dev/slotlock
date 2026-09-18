import { describe, expect, it } from 'vitest';
import { requestHash } from '../../src/idempotency/idempotency.service';

describe('requestHash', () => {
  const body = {
    resourceId: 'room-1',
    startsAt: '2026-10-01T09:00:00Z',
    endsAt: '2026-10-01T10:00:00Z',
  };

  it('is stable for the same user, route and body', () => {
    expect(requestHash('u1', 'POST', '/bookings', body)).toBe(
      requestHash('u1', 'post', '/bookings', { ...body }),
    );
  });

  it('changes when the body, the route or the user changes', () => {
    const base = requestHash('u1', 'POST', '/bookings', body);
    expect(requestHash('u1', 'POST', '/bookings', { ...body, resourceId: 'room-2' })).not.toBe(
      base,
    );
    expect(requestHash('u1', 'POST', '/other', body)).not.toBe(base);
    expect(requestHash('u2', 'POST', '/bookings', body)).not.toBe(base);
  });
});
