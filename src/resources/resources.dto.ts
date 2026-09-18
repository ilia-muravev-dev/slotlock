import { z } from 'zod';

const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const availabilityQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    slot: z.coerce
      .number()
      .int()
      .refine((n) => [15, 30, 60].includes(n), 'slot must be 15, 30 or 60')
      .default(60),
  })
  .refine((q) => q.to > q.from, { message: 'to must be after from', path: ['to'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_WINDOW_MS, {
    message: 'window must be 14 days or less',
    path: ['to'],
  });

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface SlotAvailability {
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  available: number;
}

export interface ResourceOut {
  id: string;
  kind: 'ROOM' | 'DESK_POOL';
  name: string;
  capacity: number;
  priceCents: number;
}
