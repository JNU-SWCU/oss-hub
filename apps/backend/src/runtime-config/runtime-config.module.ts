import { Global, Module } from '@nestjs/common';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config.instance';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: RUNTIME_CONFIG,
      useValue: PROCESS_RUNTIME_CONFIG,
    },
  ],
  exports: [RUNTIME_CONFIG],
})
export class RuntimeConfigModule {}
