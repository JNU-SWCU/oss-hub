import { Injectable } from '@nestjs/common';
import {
  Cron,
  Interval,
  ScheduleModule,
  SchedulerRegistry,
  Timeout,
} from '@nestjs/schedule';
import { PROCESS_RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import type { RuntimeConfig } from '../platform/runtime-config.config';

export class MaintenanceVerificationError extends Error {
  constructor(readonly reason: string) {
    super(`Maintenance verification failed: ${reason}`);
    this.name = 'MaintenanceVerificationError';
  }
}

export class MaintenanceConfig {
  static enabled(
    config: Pick<RuntimeConfig, 'OSS_HUB_MAINTENANCE'> = PROCESS_RUNTIME_CONFIG,
  ): boolean {
    return config.OSS_HUB_MAINTENANCE === '1';
  }

  static scheduleOptions(
    config: Pick<RuntimeConfig, 'OSS_HUB_MAINTENANCE'> = PROCESS_RUNTIME_CONFIG,
  ) {
    const enabled = !MaintenanceConfig.enabled(config);
    return { cronJobs: enabled, intervals: enabled, timeouts: enabled };
  }

  static scheduleState(registry: SchedulerRegistry) {
    const state = {
      cronJobs: registry.getCronJobs().size,
      intervals: registry.getIntervals().length,
      timeouts: registry.getTimeouts().length,
    };
    if (state.cronJobs !== 0 || state.intervals !== 0 || state.timeouts !== 0) {
      throw new MaintenanceVerificationError('scheduled jobs are registered');
    }
    return state;
  }

  static requireMaintenance(): void {
    if (!MaintenanceConfig.enabled()) {
      throw new MaintenanceVerificationError(
        'OSS_HUB_MAINTENANCE=1 is required',
      );
    }
  }
}

@Injectable()
export class MaintenanceScheduleProbe {
  @Cron('0 0 1 1 *', { name: 'maintenance-capability-cron' })
  cron(): void {
    throw new MaintenanceVerificationError('cron probe executed');
  }

  @Interval('maintenance-capability-interval', 60_000)
  interval(): void {
    throw new MaintenanceVerificationError('interval probe executed');
  }

  @Timeout('maintenance-capability-timeout', 60_000)
  timeout(): void {
    throw new MaintenanceVerificationError('timeout probe executed');
  }
}

export const APPLICATION_SCHEDULE_MODULE = ScheduleModule.forRoot(
  MaintenanceConfig.scheduleOptions(),
);
