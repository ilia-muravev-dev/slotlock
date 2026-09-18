import type { Strategy } from '../../config';
import type { PrismaService } from '../../prisma/prisma.service';

export interface ReserveInput {
  resource: { id: string; capacity: number; exclusive: boolean };
  userId: string;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date;
}

export interface ReservedBooking {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'HELD';
  holdExpiresAt: Date | null;
}

/**
 * Creates a HELD booking if the resource has capacity for [startsAt, endsAt), atomically with
 * respect to every other caller — or throws NoCapacityError. Each implementation serialises
 * differently; see docs/adr/0001.
 */
export interface ReserveStrategy {
  readonly name: Strategy;
  reserve(input: ReserveInput): Promise<ReservedBooking>;
}

export const RESERVE_STRATEGY = Symbol('RESERVE_STRATEGY');

/** The transaction client Prisma hands to `$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const ACTIVE = ['HELD', 'CONFIRMED'] as const;

/** Active bookings of the resource that intersect the slot (half-open intervals). */
export function countOverlapping(tx: Tx, input: ReserveInput): Promise<number> {
  return tx.booking.count({
    where: {
      resourceId: input.resource.id,
      status: { in: [...ACTIVE] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
  });
}

export function insertHeld(tx: Tx, input: ReserveInput): Promise<ReservedBooking> {
  return tx.booking.create({
    data: {
      resourceId: input.resource.id,
      userId: input.userId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      exclusive: input.resource.exclusive,
      status: 'HELD',
      holdExpiresAt: input.holdExpiresAt,
    },
    select: {
      id: true,
      resourceId: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      holdExpiresAt: true,
    },
  }) as Promise<ReservedBooking>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(attempt: number): number {
  return Math.floor(Math.random() * 20 * 2 ** attempt);
}
