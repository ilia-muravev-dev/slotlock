import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CONFIG, type Config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('meta')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('health')
  @ApiOkResponse({
    description: 'The process is up, the database answers, and the active strategy.',
  })
  async health(): Promise<{ status: string; database: string; strategy: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok', strategy: this.config.BOOKING_STRATEGY };
  }
}
