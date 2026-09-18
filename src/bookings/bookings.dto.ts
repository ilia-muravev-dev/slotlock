import { z } from 'zod';

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

export const createBookingSchema = z
  .object({
    resourceId: z.string().min(1).max(64).describe('A room or desk pool id, e.g. room-1'),
    startsAt: z.coerce.date().describe('ISO 8601'),
    endsAt: z.coerce.date().describe('ISO 8601; at most 8 hours after startsAt'),
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

export const bookingOutSchema = z.object({
  id: z.uuid(),
  resourceId: z.string(),
  userId: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: z.enum(['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED']),
  holdExpiresAt: z.iso.datetime().nullable().describe('When a HELD booking expires unpaid'),
  amountCents: z.int(),
  paymentId: z.string().nullable(),
});
export type BookingOut = z.infer<typeof bookingOutSchema>;

/** The 201 body: the booking plus what the client needs to pay for it. */
export const createdBookingSchema = bookingOutSchema.extend({
  payment: z.object({
    provider: z.enum(['stripe', 'fake']),
    id: z.string().describe('PaymentIntent id'),
    clientSecret: z.string().nullable().describe('For Stripe.js on the client'),
  }),
});
export type CreatedBooking = z.infer<typeof createdBookingSchema>;
