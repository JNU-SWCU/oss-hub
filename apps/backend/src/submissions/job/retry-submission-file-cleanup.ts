import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { SubmissionFileCleanupRetryService } from '../service/submission-file-cleanup-retry.service';

const ENABLED_VALUE = '1';

export async function main(): Promise<void> {
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
    await app.get(SubmissionFileCleanupRetryService).retry(operatorId, fileId);
    logger.log({
      event: 'submission-file.cleanup.retry-reset',
      operatorRole: 'ADMIN',
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('Submission file cleanup retry failed\n');
    process.exitCode = 1;
  });
}
