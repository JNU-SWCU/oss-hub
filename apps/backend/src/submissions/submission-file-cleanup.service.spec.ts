import { Logger } from '@nestjs/common';
import type { SubmissionFileStoragePort } from './submission-file-storage.port';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import type { SubmissionFilesRepository } from './submission-files.repository';

const START = new Date('2026-07-25T00:00:00.000Z');

function setup() {
  let now = new Date(START);
  const files = {
    claimNextForDeletion: jest.fn(),
    markDeleted: jest.fn().mockResolvedValue(true),
    recordDeleteFailure: jest.fn().mockResolvedValue(true),
    resetDeleteAttempts: jest.fn().mockResolvedValue(true),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const service = new SubmissionFileCleanupService(
    files as unknown as SubmissionFilesRepository,
    storage as unknown as SubmissionFileStoragePort,
    () => new Date(now),
  );
  const setNow = (value: Date): void => {
    now = new Date(value);
  };
  return {
    service,
    files,
    storage,
    setNow,
  };
}

function claimed(deleteAttemptCount: number) {
  return {
    id: 'opaque-file-id',
    storageKey: 'private/object',
    deleteAttemptCount,
    claimOwner: 'claim-owner',
  };
}

describe('SubmissionFileCleanupService', () => {
  it('claims with a ten-minute lease and treats storage not-found as success', async () => {
    const { service, files, storage } = setup();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);
    storage.delete.mockResolvedValueOnce(undefined);

    await expect(service.runDue()).resolves.toBe(1);

    expect(files.claimNextForDeletion).toHaveBeenNthCalledWith(1, {
      now: START,
      leaseExpiresAt: new Date('2026-07-25T00:10:00.000Z'),
    });
    expect(files.markDeleted).toHaveBeenCalledWith(
      'opaque-file-id',
      'claim-owner',
      START,
    );
  });

  it.each([
    [0, 1, 1],
    [1, 2, 2],
    [2, 3, 4],
    [3, 4, 8],
    [4, 5, 24],
  ])(
    'schedules failure after prior attempt %i as attempt %i in %ih',
    async (priorAttempts, attemptCount, delayHours) => {
      const { service, files, storage } = setup();
      files.claimNextForDeletion
        .mockResolvedValueOnce(claimed(priorAttempts))
        .mockResolvedValueOnce(null);
      storage.delete.mockRejectedValueOnce(new Error('secret provider detail'));

      await service.runDue();

      expect(files.recordDeleteFailure).toHaveBeenCalledWith({
        id: 'opaque-file-id',
        claimOwner: 'claim-owner',
        attemptCount,
        nextAttemptAt: new Date(START.getTime() + delayHours * 60 * 60 * 1_000),
        error: 'STORAGE_DELETE_FAILED',
      });
    },
  );

  it('leaves the sixth failure exhausted without another due time and alerts redacted data', async () => {
    const { service, files, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    storage.delete.mockRejectedValueOnce(new Error('credential=do-not-log'));

    await service.runDue();

    expect(files.recordDeleteFailure).toHaveBeenCalledWith({
      id: 'opaque-file-id',
      claimOwner: 'claim-owner',
      attemptCount: 6,
      nextAttemptAt: null,
      error: 'STORAGE_DELETE_FAILED',
    });
    expect(alert).toHaveBeenCalledWith({
      event: 'submission-file.cleanup.exhausted',
      fileId: 'opaque-file-id',
      attemptCount: 6,
      error: 'storage_delete_failed',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('credential');
    alert.mockRestore();
  });

  it('does not alert when the claim was concurrently lost before failure was recorded', async () => {
    const { service, files, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    files.recordDeleteFailure.mockResolvedValueOnce(false);
    storage.delete.mockRejectedValueOnce(new Error('provider-secret'));

    await service.runDue();

    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('allows an operator reset to be reclaimed with attempt zero', async () => {
    const { service, files, storage, setNow } = setup();
    const resetAt = new Date('2026-07-26T12:00:00.000Z');
    setNow(resetAt);
    await files.resetDeleteAttempts('opaque-file-id', resetAt);
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);

    await service.runDue();

    expect(files.resetDeleteAttempts.mock.calls).toContainEqual([
      'opaque-file-id',
      resetAt,
    ]);
    expect(storage.delete.mock.calls).toContainEqual(['private/object']);
  });
});
