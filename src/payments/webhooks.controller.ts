import { Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment.provider';
import { type AppliedEvent, PaymentEventsService } from './payment-events.service';

@ApiTags('payments')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly events: PaymentEventsService,
  ) {}

  @Post('payments')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Payment provider webhook (Stripe signature scheme)',
    description:
      'Idempotent and order-independent: the response reports whether the event was APPLIED, ' +
      'STALE (older than one already applied), DUPLICATE, ORPHANED (money for a booking that no ' +
      'longer holds its seat), IGNORED (a type that changes nothing) or UNKNOWN (no such payment).',
  })
  @ApiOkResponse({ description: 'The event was recorded; `outcome` says what it did.' })
  @ApiBadRequestResponse({ description: 'invalid_signature' })
  payments(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<AppliedEvent> {
    const event = this.provider.constructEvent(request.rawBody ?? '', signature);
    return this.events.apply(event);
  }
}
