import { describe, expect, it, vi } from 'vitest';
import { ExclusionStrategy } from '../../src/bookings/strategies/exclusion.strategy';
import type { ReserveInput } from '../../src/bookings/strategies/reserve.strategy';
import { loadConfig, SAFE_STRATEGIES, STRATEGIES } from '../../src/config';

const env = { DATABASE_URL: 'postgresql://x:y@localhost:5432/z' };

describe('BOOKING_STRATEGY', () => {
  it.each(STRATEGIES)('accepts %s outside production', (strategy) => {
    expect(loadConfig({ ...env, BOOKING_STRATEGY: strategy }).BOOKING_STRATEGY).toBe(strategy);
  });

  it('refuses the naive control in production', () => {
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', BOOKING_STRATEGY: 'naive' })).toThrow(
      /naive/,
    );
    expect(
      loadConfig({ ...env, NODE_ENV: 'production', BOOKING_STRATEGY: 'advisory' }).BOOKING_STRATEGY,
    ).toBe('advisory');
  });

  it('keeps naive out of the safe list', () => {
    expect(SAFE_STRATEGIES).toEqual([
      'advisory',
      'for_update',
      'optimistic',
      'serializable',
      'exclusion',
    ]);
  });
});

describe('ExclusionStrategy', () => {
  const input = (exclusive: boolean): ReserveInput => ({
    resource: { id: 'r', capacity: exclusive ? 1 : 3, exclusive },
    userId: 'u',
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 3_600_000),
    holdExpiresAt: new Date(),
  });

  it('delegates pools to the advisory strategy because a constraint cannot count to N', async () => {
    const advisory = { reserve: vi.fn().mockResolvedValue({ id: 'b' }) };
    const prisma = { $transaction: vi.fn() };
    const strategy = new ExclusionStrategy(prisma as never, advisory as never);
    await strategy.reserve(input(false));
    expect(advisory.reserve).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('turns the constraint violation into a 409 no_capacity', async () => {
    const advisory = { reserve: vi.fn() };
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(
        Object.assign(
          new Error('conflicting key value violates exclusion constraint "booking_no_overlap"'),
          {
            code: 'P2010',
            meta: { code: '23P01' },
          },
        ),
      ),
    };
    const strategy = new ExclusionStrategy(prisma as never, advisory as never);
    await expect(strategy.reserve(input(true))).rejects.toMatchObject({ status: 409 });
    expect(advisory.reserve).not.toHaveBeenCalled();
  });
});
