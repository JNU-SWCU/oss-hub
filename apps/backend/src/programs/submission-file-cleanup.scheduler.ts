import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';

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
