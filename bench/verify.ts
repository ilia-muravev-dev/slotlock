// Judges a run from the database alone: was any room ever double-booked, was any pool ever over
// capacity? A booking holds its seat from createdAt until it is cancelled or expired (updatedAt),
// or still, so two bookings overlapping in slot and in that active interval were double-booked
// even if one was cancelled later. The naive control must fail this; the five must not.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

export interface Verdict {
  bookings: number;
  activeNow: number;
  overlaps: number;
  overCapacity: number;
  ok: boolean;
}

interface Row {
  id: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const ACTIVE = new Set(['HELD', 'CONFIRMED']);

function activeUntil(row: Row): number {
  return ACTIVE.has(row.status) ? Number.POSITIVE_INFINITY : row.updatedAt.getTime();
}

function overlap(a: Row, b: Row): boolean {
  const slots = a.startsAt < b.endsAt && b.startsAt < a.endsAt;
  const time = a.createdAt.getTime() < activeUntil(b) && b.createdAt.getTime() < activeUntil(a);
  return slots && time;
}

export function judge(rows: Row[], capacities: Map<string, number>): Verdict {
  let overlaps = 0;
  let overCapacity = 0;
  const byResource = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byResource.get(row.resourceId) ?? [];
    list.push(row);
    byResource.set(row.resourceId, list);
  }
  for (const [resourceId, list] of byResource) {
    const capacity = capacities.get(resourceId) ?? 1;
    if (capacity === 1) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (overlap(list[i] as Row, list[j] as Row)) overlaps += 1;
        }
      }
    } else {
      // sweep the active intervals: at any instant, per slot instant, at most `capacity` active
      for (const row of list) {
        const at = row.createdAt.getTime();
        const concurrent = list.filter(
          (other) =>
            other.createdAt.getTime() <= at &&
            at < activeUntil(other) &&
            other.startsAt < row.endsAt &&
            row.startsAt < other.endsAt,
        ).length;
        if (concurrent > capacity) overCapacity += 1;
      }
    }
  }
  const activeNow = rows.filter((r) => ACTIVE.has(r.status)).length;
  return {
    bookings: rows.length,
    activeNow,
    overlaps,
    overCapacity,
    ok: overlaps === 0 && overCapacity === 0,
  };
}

export async function verify(databaseUrl: string): Promise<Verdict> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const [rows, resources] = await Promise.all([
      prisma.booking.findMany({
        select: {
          id: true,
          resourceId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.resource.findMany({ select: { id: true, capacity: true } }),
    ]);
    return judge(rows, new Map(resources.map((r) => [r.id, r.capacity])));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  verify(url).then((verdict) => {
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.ok ? 0 : 1);
  });
}
