import { Injectable } from '@nestjs/common';
import type { Tx } from '../bookings/strategies/reserve.strategy';
import type { Prisma } from '../generated/prisma/client';

export type OutboxEventType =
  | 'booking.held'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'booking.expired'
  | 'payment.orphaned'
  | 'payment.refund_requested';

export interface OutboxPayload {
  bookingId: string;
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * The transactional outbox (ADR 0004): an event is a row written in the same transaction as the
 * state change it announces, so the two cannot disagree. The relay in the worker publishes rows
 * to the queue; the consumer makes duplicate deliveries harmless.
 */
@Injectable()
export class OutboxService {
  enqueue(tx: Tx, type: OutboxEventType, payload: OutboxPayload): Promise<{ id: string }> {
    return tx.outboxEvent.create({
      data: { type, payload: payload as Prisma.InputJsonObject },
      select: { id: true },
    });
  }

  enqueueMany(
    tx: Tx,
    events: { type: OutboxEventType; payload: OutboxPayload }[],
  ): Promise<{ count: number }> {
    if (events.length === 0) return Promise.resolve({ count: 0 });
    return tx.outboxEvent.createMany({
      data: events.map((e) => ({ type: e.type, payload: e.payload as Prisma.InputJsonObject })),
    });
  }
}
