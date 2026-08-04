import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubmissionFilesRepository } from './submission-files.repository';

/**
 * 운영자에게 노출하는 소진 항목(#545).
 * `fileId`는 `submissions:retry-file-cleanup` CLI가 그대로 받는 opaque id이며,
 * 파일명·저장소 키·업로더 등 식별 정보는 어떤 필드로도 싣지 않는다.
 */
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
