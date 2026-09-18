import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/** Five meeting rooms and two hot-desk pools; ids are stable so demos and benchmarks can name them. */
export const SEED_RESOURCES = [
  { id: 'room-1', kind: 'ROOM', name: 'Room 1 — Aurora', capacity: 1, priceCents: 2500 },
  { id: 'room-2', kind: 'ROOM', name: 'Room 2 — Borealis', capacity: 1, priceCents: 2500 },
  { id: 'room-3', kind: 'ROOM', name: 'Room 3 — Cirrus', capacity: 1, priceCents: 3000 },
  { id: 'room-4', kind: 'ROOM', name: 'Room 4 — Drizzle', capacity: 1, priceCents: 3000 },
  { id: 'room-5', kind: 'ROOM', name: 'Room 5 — Eclipse', capacity: 1, priceCents: 4000 },
  {
    id: 'pool-hot-desks',
    kind: 'DESK_POOL',
    name: 'Hot desks (open floor)',
    capacity: 20,
    priceCents: 1500,
  },
  { id: 'pool-quiet', kind: 'DESK_POOL', name: 'Quiet desks', capacity: 3, priceCents: 1800 },
] as const;

export async function seed(prisma: PrismaClient): Promise<number> {
  for (const resource of SEED_RESOURCES) {
    await prisma.resource.upsert({
      where: { id: resource.id },
      create: resource,
      update: { name: resource.name, capacity: resource.capacity, priceCents: resource.priceCents },
    });
  }
  return SEED_RESOURCES.length;
}

if (require.main === module) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });
  seed(prisma)
    .then((count) => console.log(`seeded ${count} resources`))
    .finally(() => prisma.$disconnect());
}
