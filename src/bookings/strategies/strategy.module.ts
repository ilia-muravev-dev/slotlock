import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdvisoryStrategy } from './advisory.strategy';
import { ExclusionStrategy } from './exclusion.strategy';
import { ForUpdateStrategy } from './for-update.strategy';
import { NaiveStrategy } from './naive.strategy';
import { OptimisticStrategy } from './optimistic.strategy';
import { RESERVE_STRATEGY, type ReserveStrategy } from './reserve.strategy';
import { SerializableStrategy } from './serializable.strategy';

const ALL = [
  AdvisoryStrategy,
  ForUpdateStrategy,
  OptimisticStrategy,
  SerializableStrategy,
  ExclusionStrategy,
  NaiveStrategy,
];

@Module({
  providers: [
    ...ALL,
    {
      provide: RESERVE_STRATEGY,
      inject: [CONFIG, ...ALL],
      useFactory: (config: Config, ...strategies: ReserveStrategy[]): ReserveStrategy => {
        const chosen = strategies.find((s) => s.name === config.BOOKING_STRATEGY);
        if (!chosen) throw new Error(`no strategy named ${config.BOOKING_STRATEGY}`);
        return chosen;
      },
    },
  ],
  exports: [RESERVE_STRATEGY, ...ALL],
})
export class StrategyModule implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
  ) {}

  /** The exclusion constraint exists only while the exclusion strategy is the active one. */
  async onModuleInit(): Promise<void> {
    await ExclusionStrategy.ensureConstraint(
      this.prisma,
      this.config.BOOKING_STRATEGY === 'exclusion',
    );
  }
}
