import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';
import { HoldScheduler } from './hold.scheduler';
import { HoldsModule } from './holds.module';
import { HoldsProcessor } from './holds.processor';

/** The worker side: processes the holds queue and keeps the sweeper scheduled. */
@Module({ imports: [HoldsModule], providers: [HoldsProcessor] })
export class HoldsWorkerModule implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly scheduler: HoldScheduler,
  ) {}

  onModuleInit(): Promise<void> {
    return this.scheduler.ensureSweeper(this.config.HOLD_SWEEP_INTERVAL_MS);
  }
}
