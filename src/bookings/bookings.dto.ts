import { z } from 'zod';

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

export const createBookingSchema = z
  .object({
    resourceId: z.string().min(1).max(64),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((b) => b.endsAt > b.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine((b) => b.endsAt.getTime() - b.startsAt.getTime() <= MAX_DURATION_MS, {
    message: 'a booking is at most 8 hours',
    path: ['endsAt'],
  });

export type CreateBooking = z.infer<typeof createBookingSchema>;

export interface BookingOut {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  status: 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  holdExpiresAt: string | null;
  paymentId: string | null;
}
