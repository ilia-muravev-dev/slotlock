import { describe, expect, it } from 'vitest';
import { priceFor } from '../../src/bookings/bookings.service';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 1, h, m));

describe('priceFor', () => {
  it('charges the hourly price pro rata to the minute', () => {
    expect(priceFor(2500, at(9), at(10))).toBe(2500);
    expect(priceFor(2500, at(9), at(9, 30))).toBe(1250);
    expect(priceFor(2500, at(9), at(9, 15))).toBe(625);
    expect(priceFor(3000, at(9), at(17))).toBe(24000);
  });

  it('rounds to the cent', () => {
    expect(priceFor(1000, at(9), at(9, 1))).toBe(17); // 16.67
  });
});
