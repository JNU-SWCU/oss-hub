import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ClaimedProgramPurgeFileTombstone,
  ProgramPurgeFileCleanupRepository,
} from './repository/program-purge-file-cleanup.repository';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';

const DELETE_LEASE_MS = 10 * 60 * 1_000;
const MAX_DELETE_ATTEMPTS = 6;
const DEFAULT_BATCH_SIZE = 100;
const RETRY_DELAYS_MS = [
  60 * 60 * 1_000,
  2 * 60 * 60 * 1_000,
  4 * 60 * 60 * 1_000,
  8 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;

type ProgramPurgeFileCleanupStore = Pick<
  ProgramPurgeFileCleanupRepository,
  'claimNextForDeletion' | 'markDeleted' | 'recordDeleteFailure'
>;

/**
 * Program purge가 만든 template-file tombstone의 2단계 storage cleanup worker.
 * purge 트랜잭션 안에서는 절대 storage port를 호출하지 않는다.
 */
@Injectable()
export class ProgramPurgeFileCleanupService {
  private readonly logger = new Logger(ProgramPurgeFileCleanupService.name);

  constructor(
    @Inject(ProgramPurgeFileCleanupRepository)
    private readonly repository: ProgramPurgeFileCleanupStore,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: Pick<SubmissionFileStoragePort, 'delete'>,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runDue(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    let claimedCount = 0;
    for (let index = 0; index < batchSize; index += 1) {
      const claimedAt = this.now();
      const tombstone = await this.repository.claimNextForDeletion({
        now: claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + DELETE_LEASE_MS),
      });
      if (tombstone === null) break;
      claimedCount += 1;
      await this.deleteClaimed(tombstone);
    }
    return claimedCount;
  }

  private async deleteClaimed(
    tombstone: ClaimedProgramPurgeFileTombstone,
  ): Promise<void> {
    try {
      await this.storage.delete(tombstone.storageKey);
      await this.repository.markDeleted(
        tombstone.id,
        tombstone.claimOwner,
        this.now(),
      );
    } catch {
      await this.recordFailure(tombstone);
    }
  }

  private async recordFailure(
    tombstone: ClaimedProgramPurgeFileTombstone,
  ): Promise<void> {
    const attemptedAt = this.now();
    const attemptCount = tombstone.deleteAttemptCount + 1;
    const delay = RETRY_DELAYS_MS[attemptCount - 1];
    const nextDeleteAttemptAt =
      attemptCount < MAX_DELETE_ATTEMPTS && delay !== undefined
        ? new Date(attemptedAt.getTime() + delay)
        : null;
    const recorded = await this.repository.recordDeleteFailure({
      id: tombstone.id,
      claimOwner: tombstone.claimOwner,
      attemptCount,
      nextDeleteAttemptAt,
    });
    if (recorded && attemptCount >= MAX_DELETE_ATTEMPTS) {
      this.logger.error({
        event: 'program-purge-file.cleanup.exhausted',
        tombstoneId: tombstone.id,
        attemptCount,
        error: 'storage_delete_failed',
      });
    }
  }
}
