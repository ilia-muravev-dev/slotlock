import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

export interface Notification {
  id: string;
  type: string;
  payload: unknown;
  deliveredAt: Date;
}

/**
 * Where notifications go. This one logs them and keeps the last few hundred in memory for
 * inspection; an e-mail or push implementation would replace it behind the same shape.
 */
@Injectable()
export class NotificationSink {
  readonly recent: Notification[] = [];

  constructor(private readonly logger: Logger) {}

  async deliver(notification: Omit<Notification, 'deliveredAt'>): Promise<void> {
    const delivered = { ...notification, deliveredAt: new Date() };
    this.recent.push(delivered);
    if (this.recent.length > 500) this.recent.shift();
    this.logger.log(
      { id: notification.id, type: notification.type, payload: notification.payload },
      'notification',
    );
  }
}
