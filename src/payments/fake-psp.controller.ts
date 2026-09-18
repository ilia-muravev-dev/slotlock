import { Body, Controller, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type FakeOutcome, FakePaymentProvider, type SignedEvent } from './fake.provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment.provider';
import { type AppliedEvent, PaymentEventsService } from './payment-events.service';

const paySchema = z.object({
  outcome: z.enum(['succeeded', 'canceled']).default('succeeded'),
  /** `stripe` is the order Stripe creates them in; `reversed` and `shuffled` are the bad days. */
  order: z.enum(['stripe', 'reversed', 'shuffled']).default('shuffled'),
  /** Deliver the final event twice, as a retrying provider would. */
  duplicate: z.boolean().default(true),
});
type Pay = z.infer<typeof paySchema>;

export interface Delivery {
  type: string;
  createdAt: string;
  outcome: AppliedEvent['outcome'];
  status?: string;
}

/**
 * The "customer paid" button of the in-process PSP (404 when Stripe is the provider): generates
 * the signed events Stripe would send and delivers them through the same verification and
 * application path as the real webhook — in the order you ask for, duplicates included.
 */
@ApiTags('fake-psp')
@Controller('fake-psp')
export class FakePspController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly events: PaymentEventsService,
  ) {}

  @Post('payments/:paymentId/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulate the customer paying (or the intent being canceled)' })
  async pay(
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(paySchema)) body: Pay,
  ): Promise<{ delivered: Delivery[] }> {
    if (!(this.provider instanceof FakePaymentProvider)) {
      throw new NotFoundException({ code: 'not_found', message: 'the fake PSP is not active' });
    }
    const events = order(
      await this.provider.pay(paymentId, body.outcome as FakeOutcome),
      body.order,
    );
    if (body.duplicate) {
      const last = events.find((e) => e.type === `payment_intent.${body.outcome}`);
      if (last) events.push(last);
    }
    const delivered: Delivery[] = [];
    for (const event of events) {
      const parsed = this.provider.constructEvent(event.payload, event.signature);
      const result = await this.events.apply(parsed);
      delivered.push({
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        outcome: result.outcome,
        ...(result.status ? { status: result.status } : {}),
      });
    }
    return { delivered };
  }
}

function order(events: SignedEvent[], how: Pay['order']): SignedEvent[] {
  if (how === 'stripe') return [...events];
  if (how === 'reversed') return [...events].reverse();
  const shuffled = [...events];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as SignedEvent, shuffled[i] as SignedEvent];
  }
  return shuffled;
}
