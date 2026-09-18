import { describe, expect, it } from 'vitest';
import { isRetryableConflict, PG, pgCode } from '../../src/common/errors';

describe('pgCode', () => {
  it('reads a driver-adapter error thrown inside an interactive transaction', () => {
    const conflict = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
    });
    const unique = Object.assign(new Error('UniqueConstraintViolation'), {
      cause: { kind: 'UniqueConstraintViolation', constraint: { fields: ['key'] } },
    });
    const raw = Object.assign(new Error('postgres'), {
      cause: { kind: 'postgres', code: '23P01' },
    });
    expect(pgCode(conflict)).toBe(PG.serializationFailure);
    expect(pgCode(unique)).toBe(PG.uniqueViolation);
    expect(pgCode(raw)).toBe(PG.exclusionViolation);
  });

  it('reads Prisma known-request codes and raw-query meta', () => {
    expect(pgCode({ code: 'P2002', meta: { target: ['key'] } })).toBe(PG.uniqueViolation);
    expect(pgCode({ code: 'P2034' })).toBe(PG.serializationFailure);
    expect(
      pgCode({ code: 'P2010', meta: { code: '23P01', message: 'conflicting key value' } }),
    ).toBe(PG.exclusionViolation);
  });

  it('falls back to the SQLSTATE in the message, and gives up otherwise', () => {
    expect(pgCode(new Error('ERROR: deadlock detected (SQLSTATE 40P01)'))).toBe(
      PG.deadlockDetected,
    );
    expect(pgCode(new Error('something else'))).toBeUndefined();
    expect(pgCode(null)).toBeUndefined();
  });
});

describe('isRetryableConflict', () => {
  it('is true only for serialization failures and deadlocks', () => {
    expect(isRetryableConflict({ code: 'P2034' })).toBe(true);
    expect(isRetryableConflict(new Error('40P01'))).toBe(true);
    expect(isRetryableConflict({ code: 'P2002' })).toBe(false);
    expect(isRetryableConflict(new Error('boom'))).toBe(false);
  });
});
