import { DynamicModule, Global, Module } from '@nestjs/common';
import { CONFIG, type Config, loadConfig } from './config';

/** Provides the validated configuration everywhere; tests pass their own values. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config?: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config ?? loadConfig() }],
      exports: [CONFIG],
    };
  }
}
