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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import {
  type BookingOut,
  type CreateBooking,
  type CreatedBooking,
  createBookingSchema,
} from './bookings.dto';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Hold a resource for a time slot (idempotent)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per attempt; retries reuse it.',
  })
  @ApiHeader({ name: 'X-User-Id', required: true })
  @ApiCreatedResponse({
    description: 'The booking is HELD until the hold expires or a payment confirms it.',
  })
  @ApiConflictResponse({ description: 'no_capacity, or request_in_flight for a concurrent retry.' })
  @ApiUnprocessableEntityResponse({
    description: 'idempotency_key_reused with a different request.',
  })
  create(
    @Headers('x-user-id') userId: string,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBooking,
  ): Promise<CreatedBooking> {
    return this.bookings.create(userId, body);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One booking.' })
  get(@Param('id') id: string): Promise<BookingOut> {
    return this.bookings.get(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a held or confirmed booking (owner only; idempotent)' })
  @ApiHeader({ name: 'X-User-Id', required: true })
  @ApiOkResponse({ description: 'The booking, now CANCELLED.' })
  @ApiConflictResponse({
    description: 'invalid_transition: an EXPIRED booking cannot be cancelled.',
  })
  cancel(@Param('id') id: string, @Headers('x-user-id') userId: string): Promise<BookingOut> {
    if (!userId)
      throw new BadRequestException({ code: 'user_required', message: 'send an X-User-Id header' });
    return this.bookings.cancel(id, userId);
  }
}
