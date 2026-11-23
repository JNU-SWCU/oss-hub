import { PROCESS_RUNTIME_CONFIG } from '../runtime-config-instance.config';

export class HealthResponseDto {
  declare readonly status: 'ok';
  declare readonly version: string;

  static from(): HealthResponseDto {
    const version = PROCESS_RUNTIME_CONFIG.APP_VERSION?.trim() || 'dev';
    return { status: 'ok', version };
  }
}
