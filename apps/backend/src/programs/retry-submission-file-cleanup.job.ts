import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { SubmissionFileCleanupRetryService } from './submission-file-cleanup.service';

const ENABLED_VALUE = '1';

export class RetrySubmissionFileCleanupJob {
  async run(): Promise<void> {
    const logger = new Logger('retry-submission-file-cleanup-cli');
    const runtime = loadRuntimeConfig(process.env);
    const fileId = process.argv[2]?.trim();
    const operatorId = runtime.SUBMISSION_FILE_CLEANUP_OPERATOR_ID?.trim();

    if (runtime.SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED !== ENABLED_VALUE) {
      throw new Error('Submission file cleanup maintenance is disabled');
    }
    if (!operatorId || !fileId || process.argv.length !== 3) {
      throw new Error(
        'Authorized operator and exactly one opaque file id are required',
      );
    }

    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    try {
      await app
        .get(SubmissionFileCleanupRetryService)
        .retry(operatorId, fileId);
      logger.log({
        event: 'submission-file.cleanup.retry-reset',
        operatorRole: 'ADMIN',
      });
    } finally {
      await app.close();
    }
  }
}

if (require.main === module) {
  void new RetrySubmissionFileCleanupJob().run().catch(() => {
    process.stderr.write('Submission file cleanup retry failed\n');
    process.exitCode = 1;
  });
}
