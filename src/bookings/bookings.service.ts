import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  BookingNotFoundError,
  ForbiddenError,
  InvalidTransitionError,
  PaymentProviderError,
  ResourceNotFoundError,
} from '../common/errors';
import { retryOnConflict } from '../common/retry';
import { CONFIG, type Config } from '../config';
import type { Booking } from '../generated/prisma/client';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import type { BookingOut, CreateBooking, CreatedBooking } from './bookings.dto';
import { HoldScheduler } from './holds/hold.scheduler';
import { RESERVE_STRATEGY, type ReserveStrategy } from './strategies/reserve.strategy';

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = { now: () => new Date() };

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RESERVE_STRATEGY) private readonly strategy: ReserveStrategy,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly holds: HoldScheduler,
    private readonly logger: Logger,
  ) {}

  get strategyName(): string {
    return this.strategy.name;
  }

  /**
   * Reserve first, then ask the PSP for an intent: an intent for a seat we do not have is waste,
   * and a hold we cannot charge for is released again so the client's retry can reserve anew.
   */
  async create(userId: string, input: CreateBooking): Promise<CreatedBooking> {
    const resource = await this.prisma.resource.findUnique({ where: { id: input.resourceId } });
    if (!resource) throw new ResourceNotFoundError(input.resourceId);
    const now = this.clock.now();
    const held = await this.strategy.reserve({
      resource: {
        id: resource.id,
        capacity: resource.capacity,
        exclusive: resource.kind === 'ROOM',
      },
      userId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      holdExpiresAt: new Date(now.getTime() + this.config.HOLD_TTL_SECONDS * 1000),
    });
    const amountCents = priceFor(resource.priceCents, input.startsAt, input.endsAt);
    let intent: Awaited<ReturnType<PaymentProvider['createIntent']>>;
    try {
      intent = await this.payments.createIntent({
        bookingId: held.id,
        amountCents,
        currency: this.config.PAYMENT_CURRENCY,
      });
    } catch (error) {
      await retryOnConflict(() =>
        this.prisma.booking.update({ where: { id: held.id }, data: { status: 'CANCELLED' } }),
      ).catch(() => undefined); // if this fails too, the hold expires on its own
      throw new PaymentProviderError(error);
    }
    const booking = await retryOnConflict(() =>
      this.prisma.booking.update({
        where: { id: held.id },
        data: { paymentId: intent.id, amountCents },
      }),
    );
    if (booking.holdExpiresAt) await this.holds.schedule(booking.id, booking.holdExpiresAt, now);
    return {
      ...toBookingOut(booking),
      payment: { provider: this.payments.name, id: intent.id, clientSecret: intent.clientSecret },
    };
  }

  async get(id: string): Promise<BookingOut> {
    const row = await this.prisma.booking.findUnique({ where: { id } });
    if (!row) throw new BookingNotFoundError(id);
    return toBookingOut(row);
  }

  /**
   * The owner may cancel a HELD or CONFIRMED booking; cancelling again is a no-op. An EXPIRED
   * booking has nothing left to cancel. A held payment intent is cancelled best effort — if the
   * customer pays in the same instant, the webhook records the money as ORPHANED for a refund.
   */
  async cancel(id: string, userId: string): Promise<BookingOut> {
    const before = await retryOnConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; userId: string; status: Booking['status']; paymentId: string | null }[]
        >`SELECT id, "userId", status, "paymentId" FROM bookings WHERE id = ${id} FOR UPDATE`;
        const row = rows[0];
        if (!row) throw new BookingNotFoundError(id);
        if (row.userId !== userId) throw new ForbiddenError('only the booking owner can cancel it');
        if (row.status === 'CANCELLED') return row;
        if (row.status === 'EXPIRED') throw new InvalidTransitionError(row.status, 'CANCELLED');
        await tx.booking.update({
          where: { id },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        return row;
      }),
    );
    if (before.status === 'HELD' && before.paymentId) {
      await this.payments.cancelIntent(before.paymentId).catch((error: unknown) => {
        this.logger.warn({ err: error, bookingId: id }, 'could not cancel the payment intent');
      });
    }
    return this.get(id);
  }
}

/** Hourly prices, pro-rated to the minute and rounded to the cent. */
export function priceFor(priceCentsPerHour: number, startsAt: Date, endsAt: Date): number {
  const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  return Math.round((priceCentsPerHour * minutes) / 60);
}

export function toBookingOut(row: Booking): BookingOut {
  return {
    id: row.id,
    resourceId: row.resourceId,
    userId: row.userId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    amountCents: row.amountCents,
    paymentId: row.paymentId,
  };
}
