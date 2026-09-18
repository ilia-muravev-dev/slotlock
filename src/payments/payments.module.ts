import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import Stripe from 'stripe';
import { CONFIG, type Config } from '../config';
import { FakePaymentProvider } from './fake.provider';
import { FakePspController } from './fake-psp.controller';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment.provider';
import { PaymentEventsService } from './payment-events.service';
import { StripeProvider } from './stripe.provider';
import { WebhooksController } from './webhooks.controller';

/**
 * Stripe when STRIPE_SECRET_KEY is set, otherwise the in-process fake — the same signed-webhook
 * path either way. The fake PSP's endpoint answers 404 under Stripe.
 */
@Module({
  controllers: [WebhooksController, FakePspController],
  providers: [
    PaymentEventsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: Config): PaymentProvider =>
        cfg.STRIPE_SECRET_KEY
          ? new StripeProvider(new Stripe(cfg.STRIPE_SECRET_KEY), cfg.STRIPE_WEBHOOK_SECRET)
          : new FakePaymentProvider(cfg.STRIPE_WEBHOOK_SECRET),
    },
  ],
  exports: [PAYMENT_PROVIDER, PaymentEventsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.logger.log(`payments: ${this.provider.name} provider`, PaymentsModule.name);
  }
}
