import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubmissionFilesRepository } from './submission-files.repository';

export interface SubmissionFileCleanupFailure {
  readonly fileId: string;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly createdAt: string;
}

@Injectable()
export class SubmissionFileCleanupFailuresService {
  constructor(private readonly files: SubmissionFilesRepository) {}

  async listExhausted(
    githubId: bigint,
  ): Promise<SubmissionFileCleanupFailure[]> {
    if (!(await this.files.findActiveAdminByGithubId(githubId))) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const exhausted = await this.files.findExhaustedCleanups();
    return exhausted.map((file) => ({
      fileId: file.id,
      attemptCount: file.deleteAttemptCount,
      lastError: file.lastDeleteError,
      createdAt: file.createdAt.toISOString(),
    }));
  }
}
