import { Injectable } from '@nestjs/common';
import { onPayment, signalOf } from '../bookings/booking.state';
import type { Tx } from '../bookings/strategies/reserve.strategy';
import { PG, pgCode } from '../common/errors';
import { retryOnConflict } from '../common/retry';
import type { BookingStatus, PaymentEventOutcome } from '../generated/prisma/enums';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProviderEvent } from './payment.provider';

export interface AppliedEvent {
  outcome: PaymentEventOutcome;
  bookingId?: string;
  status?: BookingStatus;
}

/**
 * Applies provider events to bookings so that any delivery order, with any duplicates, converges
 * on the same state (ADR 0003):
 * - the booking row is locked for the duration, so deliveries of one payment run one at a time;
 * - an event id seen before is a DUPLICATE, whether it arrives after or during the first delivery;
 * - an event older than the last one applied is STALE — Stripe timestamps, not arrival, order them;
 * - the state machine in booking.state.ts decides the rest.
 */
@Injectable()
export class PaymentEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async apply(event: ProviderEvent): Promise<AppliedEvent> {
    try {
      return await retryOnConflict(() => this.transaction(event));
    } catch (error) {
      // two deliveries of one event racing on a booking-less payment collide on the primary key
      if (pgCode(error) === PG.uniqueViolation) return { outcome: 'DUPLICATE' };
      throw error;
    }
  }

  private transaction(event: ProviderEvent): Promise<AppliedEvent> {
    return this.prisma.$transaction(async (tx) => {
      const booking = event.paymentId ? await lockBooking(tx, event.paymentId) : null;
      if (await tx.paymentEvent.findUnique({ where: { id: event.id } })) {
        return { outcome: 'DUPLICATE' };
      }
      const result = await this.decide(tx, event, booking);
      await tx.paymentEvent.create({
        data: {
          id: event.id,
          paymentId: event.paymentId ?? null,
          type: event.type,
          providerCreatedAt: event.createdAt,
          outcome: result.outcome,
        },
      });
      return result;
    });
  }

  private async decide(
    tx: Tx,
    event: ProviderEvent,
    booking: LockedBooking | null,
  ): Promise<AppliedEvent> {
    if (!event.paymentId) return { outcome: 'IGNORED' };
    if (!booking) return { outcome: 'UNKNOWN' };
    const signal = signalOf(event.type);
    if (!signal) return { outcome: 'IGNORED', bookingId: booking.id, status: booking.status };
    if (booking.paymentLastEventAt && event.createdAt < booking.paymentLastEventAt) {
      return { outcome: 'STALE', bookingId: booking.id, status: booking.status };
    }
    const decision = onPayment(booking.status, signal);
    if (decision.outcome === 'ORPHANED') {
      await this.outbox.enqueue(tx, 'payment.orphaned', {
        bookingId: booking.id,
        paymentId: event.paymentId,
        eventId: event.id,
        reason: `paid_while_${booking.status.toLowerCase()}`,
      });
    }
    if (decision.outcome !== 'APPLIED') {
      return { outcome: decision.outcome, bookingId: booking.id, status: booking.status };
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: decision.next,
        paymentLastEventAt: event.createdAt,
        ...(decision.next === 'CONFIRMED' ? { holdExpiresAt: null } : {}),
        version: { increment: 1 },
      },
    });
    await this.outbox.enqueue(
      tx,
      decision.next === 'CONFIRMED' ? 'booking.confirmed' : 'booking.cancelled',
      { bookingId: booking.id, paymentId: event.paymentId, by: 'payment', eventId: event.id },
    );
    return { outcome: 'APPLIED', bookingId: booking.id, status: decision.next };
  }
}

interface LockedBooking {
  id: string;
  status: BookingStatus;
  paymentLastEventAt: Date | null;
}

async function lockBooking(tx: Tx, paymentId: string): Promise<LockedBooking | null> {
  const rows = await tx.$queryRaw<LockedBooking[]>`
    SELECT id, status, "paymentLastEventAt"
    FROM bookings WHERE "paymentId" = ${paymentId} FOR UPDATE`;
  return rows[0] ?? null;
}
