import {
  Injectable,
  Logger,
} from '../../../../node_modules/.pnpm/@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0.14.4_reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/common';
import {
  Cron,
  CronExpression,
} from '../../../../node_modules/.pnpm/@nestjs+schedule@6.1.3_@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0_e75f0cc371221d379e70a1a969cce4d1/node_modules/@nestjs/schedule';
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
