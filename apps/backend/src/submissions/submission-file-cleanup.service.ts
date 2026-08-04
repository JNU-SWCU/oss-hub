import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import { SubmissionFilesStore } from './submission-files.store';

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

  constructor(
    private readonly files: SubmissionFilesStore,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

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
