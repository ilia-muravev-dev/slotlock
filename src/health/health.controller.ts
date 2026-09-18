import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RESERVE_STRATEGY, type ReserveStrategy } from '../bookings/strategies/reserve.strategy';
import { CONFIG, type Config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export interface Health {
  status: string;
  database: string;
  strategy: string;
  /** Reserve attempts and retries since the process started, for strategies that retry. */
  reserve: { attempts: number; retries: number } | null;
}

@ApiTags('meta')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RESERVE_STRATEGY) private readonly strategy: ReserveStrategy,
  ) {}

  @Get('health')
  @ApiOkResponse({
    description: 'The process is up, the database answers, the active strategy and its counters.',
  })
  async health(): Promise<Health> {
    await this.prisma.$queryRaw`SELECT 1`;
    const counters = this.strategy as unknown as { attempts?: number; retries?: number };
    return {
      status: 'ok',
      database: 'ok',
      strategy: this.config.BOOKING_STRATEGY,
      reserve:
        typeof counters.attempts === 'number' && typeof counters.retries === 'number'
          ? { attempts: counters.attempts, retries: counters.retries }
          : null,
    };
  }
}
