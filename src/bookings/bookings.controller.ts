import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ERROR, jsonSchema } from '../common/openapi';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import {
  type BookingOut,
  bookingOutSchema,
  type CreateBooking,
  type CreatedBooking,
  createBookingSchema,
  createdBookingSchema,
} from './bookings.dto';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Hold a resource for a time slot (idempotent)',
    description:
      'Reserves the seat under the configured BOOKING_STRATEGY and creates a payment intent. ' +
      'The hold lasts HOLD_TTL_SECONDS; a payment_intent.succeeded webhook confirms it. Retrying ' +
      'with the same Idempotency-Key returns the stored answer with Idempotency-Replayed: true.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per attempt (1–128 chars); retries reuse it.',
  })
  @ApiHeader({
    name: 'X-User-Id',
    required: true,
    description: 'The demo identifies users by header.',
  })
  @ApiBody({ schema: jsonSchema(createBookingSchema) })
  @ApiCreatedResponse({
    description: 'The booking is HELD until the hold expires or a payment confirms it.',
    schema: jsonSchema(createdBookingSchema),
  })
  @ApiBadRequestResponse({
    description: 'validation failed, idempotency_key_required, user_required',
    schema: ERROR,
  })
  @ApiNotFoundResponse({ description: 'resource_not_found', schema: ERROR })
  @ApiConflictResponse({
    description: 'no_capacity, or request_in_flight for a concurrent retry.',
    schema: ERROR,
  })
  @ApiUnprocessableEntityResponse({
    description: 'idempotency_key_reused with a different request.',
    schema: ERROR,
  })
  create(
    @Headers('x-user-id') userId: string,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBooking,
  ): Promise<CreatedBooking> {
    return this.bookings.create(userId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One booking' })
  @ApiOkResponse({ description: 'One booking.', schema: jsonSchema(bookingOutSchema) })
  @ApiNotFoundResponse({ description: 'booking_not_found', schema: ERROR })
  get(@Param('id') id: string): Promise<BookingOut> {
    return this.bookings.get(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a held or confirmed booking (owner only; idempotent)' })
  @ApiHeader({ name: 'X-User-Id', required: true })
  @ApiOkResponse({
    description: 'The booking, now CANCELLED.',
    schema: jsonSchema(bookingOutSchema),
  })
  @ApiForbiddenResponse({ description: 'forbidden: not the owner', schema: ERROR })
  @ApiNotFoundResponse({ description: 'booking_not_found', schema: ERROR })
  @ApiConflictResponse({
    description: 'invalid_transition: an EXPIRED booking cannot be cancelled.',
    schema: ERROR,
  })
  cancel(@Param('id') id: string, @Headers('x-user-id') userId: string): Promise<BookingOut> {
    if (!userId)
      throw new BadRequestException({ code: 'user_required', message: 'send an X-User-Id header' });
    return this.bookings.cancel(id, userId);
  }
}
