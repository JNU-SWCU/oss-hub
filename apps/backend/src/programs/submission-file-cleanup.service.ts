import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLogService } from '../platform/audit-log.service';
import { SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS } from '../platform/audit-log-metadata.config';
import { SubmissionFilesRepository } from './submission-files.repository';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

@Injectable()
export class SubmissionFileCleanupRetryService {
  constructor(
    private readonly files: SubmissionFilesRepository,
    private readonly auditLog: AuditLogService,
    private readonly auditLogMetadataService: AuditLogMetadataService,
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
      metadata:
        this.auditLogMetadataService.createSubmissionFileCleanupAuditMetadata({
          fileId,
        }),
    });
  }
}

const DELETE_LEASE_MS = 10 * 60 * 1_000;
const MAX_DELETE_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [
  60 * 60 * 1_000,
  2 * 60 * 60 * 1_000,
  4 * 60 * 60 * 1_000,
  8 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;
const DEFAULT_BATCH_SIZE = 100;

@Injectable()
export class SubmissionFileCleanupService {
  private readonly logger = new Logger(SubmissionFileCleanupService.name);
  private readonly schedulerLogger = new Logger(
    'SubmissionFileCleanupScheduler',
  );
  private running = false;

  constructor(
    private readonly files: SubmissionFilesRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'submission-file-cleanup',
  })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (error) {
      this.schedulerLogger.error({
        event: 'submission-file.cleanup.run.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.running = false;
    }
  }

  async runDue(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    let claimedCount = 0;
    for (let index = 0; index < batchSize; index += 1) {
      const claimedAt = this.now();
      const file = await this.files.claimNextForDeletion({
        now: claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + DELETE_LEASE_MS),
      });
      if (file === null) break;
      claimedCount += 1;
      await this.deleteClaimed(file);
    }
    return claimedCount;
  }

  private async deleteClaimed(file: {
    id: string;
    storageKey: string;
    deleteAttemptCount: number;
    claimOwner: string;
  }): Promise<void> {
    try {
      await this.storage.delete(file.storageKey);
      await this.files.markDeleted(file.id, file.claimOwner, this.now());
    } catch {
      const attemptedAt = this.now();
      const attemptCount = file.deleteAttemptCount + 1;
      const delay = RETRY_DELAYS_MS[attemptCount - 1];
      const nextAttemptAt =
        attemptCount < MAX_DELETE_ATTEMPTS && delay !== undefined
          ? new Date(attemptedAt.getTime() + delay)
          : null;
      const recorded = await this.files.recordDeleteFailure({
        id: file.id,
        claimOwner: file.claimOwner,
        attemptCount,
        nextAttemptAt,
        error: this.redactedError(),
      });
      if (recorded && attemptCount >= MAX_DELETE_ATTEMPTS) {
        this.logger.error({
          event: 'submission-file.cleanup.exhausted',
          fileId: file.id,
          attemptCount,
          error: 'storage_delete_failed',
        });
      }
    }
  }

  private redactedError(): 'STORAGE_DELETE_FAILED' {
    return 'STORAGE_DELETE_FAILED';
  }
}
