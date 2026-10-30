import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';

@Injectable()
export class ProgramPurgeFileCleanupScheduler {
  private readonly logger = new Logger(ProgramPurgeFileCleanupScheduler.name);
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
