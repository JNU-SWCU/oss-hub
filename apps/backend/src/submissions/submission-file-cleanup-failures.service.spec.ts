import { ForbiddenException } from '@nestjs/common';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import { SubmissionFilesRepository } from './submission-files.repository';

describe('SubmissionFileCleanupFailuresService', () => {
  const findActiveAdminByGithubId = jest.fn();
  const findExhaustedCleanups = jest.fn();
  const repository = {
    findActiveAdminByGithubId,
    findExhaustedCleanups,
  } as unknown as SubmissionFilesRepository;
  const service = new SubmissionFileCleanupFailuresService(repository);

  beforeEach(() => {
    findActiveAdminByGithubId.mockReset();
    findExhaustedCleanups.mockReset();
  });

  it('returns exhausted cleanup entries to an active administrator', async () => {
    findActiveAdminByGithubId.mockResolvedValue(true);
    findExhaustedCleanups.mockResolvedValue([
      {
        id: 'submission-file-1',
        deleteAttemptCount: 6,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    ]);

    await expect(service.listExhausted(1n)).resolves.toEqual([
      {
        fileId: 'submission-file-1',
        attemptCount: 6,
        lastError: 'STORAGE_DELETE_FAILED',
        createdAt: '2026-08-03T00:00:00.000Z',
      },
    ]);
  });

  it('never carries file name, storage key, or uploader into the response', async () => {
    findActiveAdminByGithubId.mockResolvedValue(true);
    findExhaustedCleanups.mockResolvedValue([
      {
        id: 'submission-file-2',
        deleteAttemptCount: 6,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        storageKey: 'submissions/2026/leak-me.pdf',
        originalFileName: '보고서 1차.pdf',
        uploaderId: 'user-leak',
        uploader: { name: '홍길동' },
      },
    ]);

    const failures = await service.listExhausted(1n);

    expect(Object.keys(failures[0]!).sort()).toEqual([
      'attemptCount',
      'createdAt',
      'fileId',
      'lastError',
    ]);
    expect(JSON.stringify(failures)).not.toMatch(
      /leak-me|보고서|홍길동|user-leak|storageKey|originalFileName|uploader/,
    );
  });

  it('rejects non-administrators before reading exhausted cleanups', async () => {
    findActiveAdminByGithubId.mockResolvedValue(false);

    await expect(service.listExhausted(1n)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findExhaustedCleanups).not.toHaveBeenCalled();
  });
});
