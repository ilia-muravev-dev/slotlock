import { Inject, Injectable } from '@nestjs/common';
import { BookingNotFoundError, ResourceNotFoundError } from '../common/errors';
import { CONFIG, type Config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import type { BookingOut, CreateBooking } from './bookings.dto';
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
  ) {}

  get strategyName(): string {
    return this.strategy.name;
  }

  async create(userId: string, input: CreateBooking): Promise<BookingOut> {
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
    return this.get(held.id);
  }

  async get(id: string): Promise<BookingOut> {
    const row = await this.prisma.booking.findUnique({ where: { id } });
    if (!row) throw new BookingNotFoundError(id);
    return {
      id: row.id,
      resourceId: row.resourceId,
      userId: row.userId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status,
      holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
      paymentId: row.paymentId,
    };
  }
}
