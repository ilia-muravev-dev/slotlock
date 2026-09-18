import {
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Domain errors carry a stable `code` the API returns as JSON; HTTP mapping happens here. */
export class NoCapacityError extends ConflictException {
  constructor(resourceId: string) {
    super({ code: 'no_capacity', message: `no capacity left on ${resourceId} for that time` });
  }
}

export class RequestInFlightError extends ConflictException {
  constructor(key: string) {
    super({
      code: 'request_in_flight',
      message: `a request with Idempotency-Key ${key} is still running`,
    });
  }
}

export class IdempotencyMismatchError extends UnprocessableEntityException {
  constructor(key: string) {
    super({
      code: 'idempotency_key_reused',
      message: `Idempotency-Key ${key} was used with a different request`,
    });
  }
}

/** An optimistic or serializable retry loop gave up; the client should retry with backoff. */
export class RetryExhaustedError extends ServiceUnavailableException {
  constructor(strategy: string, attempts: number) {
    super({
      code: 'retry_exhausted',
      message: `${strategy} strategy gave up after ${attempts} attempts; retry later`,
    });
  }
}

export class ResourceNotFoundError extends NotFoundException {
  constructor(id: string) {
    super({ code: 'resource_not_found', message: `resource ${id} not found` });
  }
}

export class BookingNotFoundError extends NotFoundException {
  constructor(id: string) {
    super({ code: 'booking_not_found', message: `booking ${id} not found` });
  }
}

export class InvalidTransitionError extends HttpException {
  constructor(from: string, to: string) {
    super({ code: 'invalid_transition', message: `a ${from} booking cannot become ${to}` }, 409);
  }
}

/** Postgres SQLSTATE codes we branch on, wherever Prisma surfaces them. */
export const PG = {
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
} as const;

/**
 * The SQLSTATE behind an error, wherever Prisma 7 puts it: a driver-adapter error's `cause`
 * (thrown as-is inside interactive transactions), a known request error's code, or the `meta`
 * of a raw-query failure.
 */
export function pgCode(error: unknown): string | undefined {
  const e = error as {
    code?: unknown;
    meta?: { code?: unknown };
    cause?: { kind?: unknown; code?: unknown };
  };
  if (e?.cause && typeof e.cause === 'object') {
    if (e.cause.kind === 'TransactionWriteConflict') return PG.serializationFailure;
    if (e.cause.kind === 'UniqueConstraintViolation') return PG.uniqueViolation;
    if (typeof e.cause.code === 'string') return e.cause.code;
  }
  if (e?.code === 'P2002') return PG.uniqueViolation;
  if (e?.code === 'P2034') return PG.serializationFailure;
  if (typeof e?.meta?.code === 'string') return e.meta.code;
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/\b(40001|40P01|23505|23P01)\b/)?.[1];
}

export function isRetryableConflict(error: unknown): boolean {
  const code = pgCode(error);
  return code === PG.serializationFailure || code === PG.deadlockDetected;
}
