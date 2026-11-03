import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  APPLICATION_SCHEDULE_MODULE,
  MaintenanceVerificationError,
  MaintenanceConfig,
  MaintenanceScheduleProbe,
} from './maintenance.config';

@Module({
  imports: [APPLICATION_SCHEDULE_MODULE],
  providers: [MaintenanceScheduleProbe],
})
export class MaintenanceModule {
  static async verify(this: void, args: readonly string[]): Promise<void> {
    MaintenanceConfig.requireMaintenance();
    if (args.length !== 0) {
      throw new MaintenanceVerificationError('no arguments are allowed');
    }
    const { GithubModule } = await import('./github.module');
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      GithubModule,
    );
    if (
      !Array.isArray(imports) ||
      !imports.includes(APPLICATION_SCHEDULE_MODULE)
    ) {
      throw new MaintenanceVerificationError(
        'production scheduler wiring differs',
      );
    }
    const app = await NestFactory.createApplicationContext(MaintenanceModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      const schedules = MaintenanceConfig.scheduleState(
        app.get(SchedulerRegistry),
      );
      process.stdout.write(
        `${JSON.stringify({ event: 'maintenance.capability.verified', schedules })}\n`,
      );
    } finally {
      await app.close();
    }
  }

  static readonly commands = new Map([
    [
      'verify-maintenance-capability',
      {
        maintenanceSafe: true as const,
        run: MaintenanceModule.verify,
        failureMessage: () => 'Maintenance capability verification failed.',
      },
    ],
  ]);
}
