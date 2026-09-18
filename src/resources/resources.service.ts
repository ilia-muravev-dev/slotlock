import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AvailabilityQuery, ResourceOut, SlotAvailability } from './resources.dto';

export const ACTIVE_STATUSES = ['HELD', 'CONFIRMED'] as const;

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ResourceOut[]> {
    const rows = await this.prisma.resource.findMany({ orderBy: { id: 'asc' } });
    return rows.map(({ id, kind, name, capacity, priceCents }) => ({
      id,
      kind,
      name,
      capacity,
      priceCents,
    }));
  }

  async get(id: string): Promise<ResourceOut> {
    const row = await this.prisma.resource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`resource ${id} not found`);
    const { kind, name, capacity, priceCents } = row;
    return { id, kind, name, capacity, priceCents };
  }

  /** Remaining capacity per slot: one query for the window, then counting in memory. */
  async availability(id: string, query: AvailabilityQuery): Promise<SlotAvailability[]> {
    const resource = await this.get(id);
    const active = await this.prisma.booking.findMany({
      where: {
        resourceId: id,
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: query.to },
        endsAt: { gt: query.from },
      },
      select: { startsAt: true, endsAt: true },
    });
    const slotMs = query.slot * 60_000;
    const slots: SlotAvailability[] = [];
    for (let start = query.from.getTime(); start < query.to.getTime(); start += slotMs) {
      const end = Math.min(start + slotMs, query.to.getTime());
      const booked = active.filter(
        (b) => b.startsAt.getTime() < end && b.endsAt.getTime() > start,
      ).length;
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        capacity: resource.capacity,
        booked,
        available: Math.max(0, resource.capacity - booked),
      });
    }
    return slots;
  }
}
