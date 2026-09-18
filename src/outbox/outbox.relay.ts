import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE } from '../queue/queue.module';

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

/**
 * Moves unpublished outbox rows onto the notifications queue, oldest first, in batches locked
 * with SKIP LOCKED so several workers can relay at once. The queue job id is the event id: if the
 * process dies between `queue.add` and the commit that marks the row published, the next relay
 * offers the same job again and BullMQ ignores it while it remembers it — and if it no longer
 * does, the consumer's processed-jobs table catches the repeat. At least once, never lost.
 */
@Injectable()
export class OutboxRelay {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async relay(batch = 100): Promise<number> {
    let total = 0;
    for (;;) {
      const published = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, type, payload FROM outbox_events
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        await this.queue.addBulk(
          rows.map((row) => ({ name: row.type, data: row.payload, opts: { jobId: row.id } })),
        );
        await tx.outboxEvent.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { publishedAt: new Date() },
        });
        return rows.length;
      });
      total += published;
      if (published < batch) break;
    }
    if (total > 0) this.logger.debug({ published: total }, 'outbox relayed');
    return total;
  }
}
