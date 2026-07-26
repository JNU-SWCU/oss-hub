import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionFilesRepository } from '../submission-files.repository';

const ENABLED_VALUE = '1';

async function main(): Promise<void> {
  const logger = new Logger('retry-submission-file-cleanup-cli');
  const fileId = process.argv[2]?.trim();
  const operatorId = process.env.SUBMISSION_FILE_CLEANUP_OPERATOR_ID?.trim();

  if (
    process.env.SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED !== ENABLED_VALUE
  ) {
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
    const prisma = app.get(PrismaService);
    const operator = await prisma.user.findUnique({
      where: { id: operatorId },
      select: { role: true, accountStatus: true },
    });
    if (operator?.role !== 'ADMIN' || operator.accountStatus !== 'ACTIVE') {
      throw new Error('Operator is not authorized for cleanup maintenance');
    }

    const reset = await app
      .get(SubmissionFilesRepository)
      .resetDeleteAttempts(fileId, new Date());
    if (!reset) {
      throw new Error('Cleanup retry target is unavailable');
    }
    logger.log({
      event: 'submission-file.cleanup.retry-reset',
      operatorRole: 'ADMIN',
    });
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write('Submission file cleanup retry failed\n');
  process.exitCode = 1;
});
