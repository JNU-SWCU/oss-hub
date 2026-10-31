import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ProgramAuthoringUploadMaintenance,
  ProgramAuthoringUploadMaintenanceService,
} from './program-authoring-upload-maintenance.service';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';

@Injectable()
export class ProgramsScheduler {
  private readonly logger = new Logger('ProgramPurgeFileCleanupScheduler');
  private running = false;

  constructor(private readonly cleanup: ProgramPurgeFileCleanupService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'program-purge-file-cleanup' })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanup.runDue();
    } catch {
      this.logger.error({
        event: 'program-purge-file.cleanup.run.failed',
        error: 'MAINTENANCE_RUN_FAILED',
      });
    } finally {
      this.running = false;
    }
  }
}

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

@Injectable()
export class SubmissionFileCleanupScheduler {
  private readonly logger = new Logger(SubmissionFileCleanupScheduler.name);
  private running = false;

  constructor(private readonly cleanup: SubmissionFileCleanupService) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'submission-file-cleanup',
  })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanup.runDue();
    } catch (error) {
      this.logger.error({
        event: 'submission-file.cleanup.run.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.running = false;
    }
  }
}
