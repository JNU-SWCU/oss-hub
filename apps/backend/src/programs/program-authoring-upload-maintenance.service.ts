import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  type ClaimedProgramAuthoringUpload,
  ProgramAuthoringUploadRepository,
} from './program-authoring-upload.repository';

const DELETE_LEASE_MS = 10 * 60 * 1_000;
const MAX_DELETE_ATTEMPTS = 6;
const MAX_BATCH_SIZE = 100;
const RETRY_DELAYS_MS = [
  60 * 60 * 1_000,
  2 * 60 * 60 * 1_000,
  4 * 60 * 60 * 1_000,
  8 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;
const STORAGE_DELETE_FAILED = 'STORAGE_DELETE_FAILED' as const;

type ProgramAuthoringUploadMaintenanceStore = Pick<
  ProgramAuthoringUploadRepository,
  'claimForDeletion' | 'markDeleted' | 'recordDeleteFailure'
>;
type ProgramAuthoringUploadDeleteStorage = Pick<
  SubmissionFileStoragePort,
  'delete'
>;

@Injectable()
export class ProgramAuthoringUploadMaintenanceService {
  private readonly logger = new Logger(
    ProgramAuthoringUploadMaintenanceService.name,
  );

  constructor(
    @Inject(ProgramAuthoringUploadRepository)
    private readonly repository: ProgramAuthoringUploadMaintenanceStore,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: ProgramAuthoringUploadDeleteStorage,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runDue(batchSize = MAX_BATCH_SIZE): Promise<number> {
    const limit = boundedBatchSize(batchSize);
    if (limit === 0) return 0;

    const claimedAt = this.now();
    const claimed = await this.repository.claimForDeletion({
      now: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + DELETE_LEASE_MS),
      limit,
    });
    for (const upload of claimed) {
      await this.deleteClaimed(upload);
    }
    return claimed.length;
  }

  private async deleteClaimed(
    upload: ClaimedProgramAuthoringUpload,
  ): Promise<void> {
    try {
      await this.storage.delete(upload.storageKey);
    } catch {
      await this.recordFailure(upload);
      return;
    }
    await this.repository.markDeleted(upload.id, upload.claimOwner, this.now());
  }

  private async recordFailure(
    upload: ClaimedProgramAuthoringUpload,
  ): Promise<void> {
    const attemptedAt = this.now();
    const attemptCount = upload.deleteAttemptCount + 1;
    const delay = RETRY_DELAYS_MS[attemptCount - 1];
    const nextAttemptAt =
      attemptCount < MAX_DELETE_ATTEMPTS && delay !== undefined
        ? new Date(attemptedAt.getTime() + delay)
        : attemptedAt;
    const recorded = await this.repository.recordDeleteFailure({
      id: upload.id,
      claimOwner: upload.claimOwner,
      attemptCount,
      nextAttemptAt,
      errorCode: STORAGE_DELETE_FAILED,
    });
    if (recorded && attemptCount === MAX_DELETE_ATTEMPTS) {
      this.logger.error({
        event: 'program-authoring-upload.cleanup.exhausted',
        uploadId: upload.id,
        attemptCount,
        errorCode: STORAGE_DELETE_FAILED,
      });
    }
  }
}

function boundedBatchSize(requested: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_BATCH_SIZE);
}
