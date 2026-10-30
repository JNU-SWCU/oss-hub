import {
  Inject,
  Injectable,
  Logger,
} from '../../../../node_modules/.pnpm/@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0.14.4_reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/common';
import {
  Cron,
  CronExpression,
} from '../../../../node_modules/.pnpm/@nestjs+schedule@6.1.3_@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0_e75f0cc371221d379e70a1a969cce4d1/node_modules/@nestjs/schedule';
import {
  ProgramAuthoringUploadMaintenance,
  ProgramAuthoringUploadMaintenanceService,
} from './program-authoring-upload-maintenance.service';

@Injectable()
export class ProgramAuthoringUploadMaintenanceScheduler {
  private readonly logger = new Logger(
    ProgramAuthoringUploadMaintenanceScheduler.name,
  );
  private running = false;

  constructor(
    @Inject(ProgramAuthoringUploadMaintenanceService)
    private readonly maintenance: ProgramAuthoringUploadMaintenance,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'program-authoring-upload-cleanup',
  })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.maintenance.runDue();
    } catch {
      this.logger.error({
        event: 'program-authoring-upload.cleanup.run.failed',
        errorCode: 'MAINTENANCE_RUN_FAILED',
      });
    } finally {
      this.running = false;
    }
  }
}
