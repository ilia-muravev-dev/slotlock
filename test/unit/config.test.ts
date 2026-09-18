import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(3000);
    expect(config.BOOKING_STRATEGY).toBe('advisory');
    expect(config.HOLD_TTL_SECONDS).toBe(600);
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('rejects unknown strategies and missing urls with a readable message', () => {
    expect(() => loadConfig({ ...base, BOOKING_STRATEGY: 'yolo' })).toThrow(/BOOKING_STRATEGY/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('treats an empty Stripe key as absent', () => {
    expect(loadConfig({ ...base, STRIPE_SECRET_KEY: '' }).STRIPE_SECRET_KEY).toBeUndefined();
    expect(loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' }).STRIPE_SECRET_KEY).toBe(
      'sk_test_x',
    );
  });
});
