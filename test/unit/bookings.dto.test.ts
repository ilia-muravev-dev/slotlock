import { describe, expect, it } from 'vitest';
import { createBookingSchema } from '../../src/bookings/bookings.dto';

const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();

describe('createBookingSchema', () => {
  it('accepts a slot and coerces the dates', () => {
    const parsed = createBookingSchema.parse({
      resourceId: 'room-1',
      startsAt: at(9),
      endsAt: at(10),
    });
    expect(parsed.startsAt).toBeInstanceOf(Date);
    expect(parsed.endsAt.getTime() - parsed.startsAt.getTime()).toBe(3_600_000);
  });

  it.each([
    ['ends before it starts', { startsAt: at(10), endsAt: at(9) }],
    ['is empty', { startsAt: at(9), endsAt: at(9) }],
    ['is longer than 8 hours', { startsAt: at(1), endsAt: at(10) }],
    ['has an unparseable date', { startsAt: 'yesterday', endsAt: at(10) }],
  ])('rejects a slot that %s', (_name, slot) => {
    expect(createBookingSchema.safeParse({ resourceId: 'room-1', ...slot }).success).toBe(false);
  });
});
