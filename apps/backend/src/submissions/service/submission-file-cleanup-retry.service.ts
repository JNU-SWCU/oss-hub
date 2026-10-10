import { Injectable } from '@nestjs/common';
import {
  SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS,
  createSubmissionFileCleanupAuditMetadata,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { SubmissionFilesRepository } from '../repository/submission-files.repository';

@Injectable()
export class SubmissionFileCleanupRetryService {
  constructor(
    private readonly files: SubmissionFilesRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async retry(operatorId: string, fileId: string): Promise<void> {
    const operator = await this.files.findCleanupOperator(operatorId);
    if (
      operator?.hasAdminAccess !== true ||
      operator.accountStatus !== 'ACTIVE'
    ) {
      throw new Error('Operator is not authorized for cleanup maintenance');
    }

    const reset = await this.files.resetDeleteAttempts(fileId, new Date());
    if (!reset) {
      throw new Error('Cleanup retry target is unavailable');
    }

    await this.auditLog.record({
      actorGithubId: operator.githubId,
      action:
        SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS.SUBMISSION_FILE_CLEANUP_RETRY_RESET,
      targetType: 'SUBMISSION_FILE',
      targetId: fileId,
      metadata: createSubmissionFileCleanupAuditMetadata({ fileId }),
    });
  }
}
