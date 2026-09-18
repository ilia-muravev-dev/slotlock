import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { retryOnConflict } from '../../common/retry';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../payments/payment.provider';
import { PrismaService } from '../../prisma/prisma.service';

interface ExpiredRow {
  id: string;
  paymentId: string | null;
}

/**
 * HELD → EXPIRED once the hold is overdue, judged by the database clock so that API, worker and
 * Postgres never disagree. The update is the guard: a hold that was confirmed or cancelled in the
 * meantime matches no row, and two workers expiring the same booking cannot both succeed.
 */
@Injectable()
export class HoldExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly logger: Logger,
  ) {}

  async expire(bookingId: string): Promise<'expired' | 'skipped'> {
    const rows = await retryOnConflict(
      () => this.prisma.$queryRaw<ExpiredRow[]>`
        UPDATE bookings SET status = 'EXPIRED', version = version + 1, "updatedAt" = now()
        WHERE id = ${bookingId} AND status = 'HELD' AND "holdExpiresAt" <= now()
        RETURNING id, "paymentId"`,
    );
    await this.release(rows);
    return rows.length > 0 ? 'expired' : 'skipped';
  }

  /** Everything overdue, in one statement per batch; lost delayed jobs end up here. */
  async sweep(batch = 500): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await retryOnConflict(
        () => this.prisma.$queryRaw<ExpiredRow[]>`
          UPDATE bookings SET status = 'EXPIRED', version = version + 1, "updatedAt" = now()
          WHERE id IN (
            SELECT id FROM bookings WHERE status = 'HELD' AND "holdExpiresAt" <= now()
            ORDER BY "holdExpiresAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED)
          RETURNING id, "paymentId"`,
      );
      await this.release(rows);
      total += rows.length;
      if (rows.length < batch) return total;
    }
  }

  /** Best effort: a cancel that fails (or races a success) is settled by the webhook — ORPHANED. */
  private async release(rows: ExpiredRow[]): Promise<void> {
    for (const row of rows) {
      if (!row.paymentId) continue;
      try {
        await this.payments.cancelIntent(row.paymentId);
      } catch (error) {
        this.logger.warn(
          { err: error, bookingId: row.id },
          'could not cancel the payment intent of an expired hold',
        );
      }
    }
  }
}
