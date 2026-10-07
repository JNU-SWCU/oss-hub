import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import {
  SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS,
  createSubmissionFileCleanupAuditMetadata,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { SubmissionFilesRepository } from '../submission-files.repository';

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
    const prisma = app.get(PrismaService);
    const operator = await prisma.user.findUnique({
      where: { id: operatorId },
      select: { githubId: true, hasAdminAccess: true, accountStatus: true },
    });
    if (
      operator?.hasAdminAccess !== true ||
      operator.accountStatus !== 'ACTIVE'
    ) {
      throw new Error('Operator is not authorized for cleanup maintenance');
    }

    const reset = await app
      .get(SubmissionFilesRepository)
      .resetDeleteAttempts(fileId, new Date());
    if (!reset) {
      throw new Error('Cleanup retry target is unavailable');
    }

    await app.get(AuditLogService).record({
      actorGithubId: operator.githubId,
      action:
        SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS.SUBMISSION_FILE_CLEANUP_RETRY_RESET,
      targetType: 'SUBMISSION_FILE',
      targetId: fileId,
      metadata: createSubmissionFileCleanupAuditMetadata({ fileId }),
    });
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
