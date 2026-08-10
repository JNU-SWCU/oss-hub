import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';

type ProgramAuthoringUploadMaintenance = Pick<
  ProgramAuthoringUploadMaintenanceService,
  'runDue'
>;

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
