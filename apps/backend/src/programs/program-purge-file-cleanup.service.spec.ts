import { Logger } from '@nestjs/common';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';

const START = new Date('2026-08-12T00:00:00.000Z');

function claimed(deleteAttemptCount: number) {
  return {
    id: 'tombstone-1',
    storageKey: 'program-authoring/template-1',
    deleteAttemptCount,
    claimOwner: 'claim-owner',
  };
}

function setup() {
  const repository = {
    claimNextForDeletion: jest.fn(),
    markDeleted: jest.fn().mockResolvedValue(true),
    recordDeleteFailure: jest.fn().mockResolvedValue(true),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgramPurgeFileCleanupService(
    repository,
    storage,
    () => START,
  );
  return { service, repository, storage };
}

describe('ProgramPurgeFileCleanupService', () => {
  it('claims a DELETE_PENDING tombstone with a ten-minute lease, deletes the object, and marks it deleted', async () => {
    const { service, repository, storage } = setup();
    repository.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);

    await expect(service.runDue()).resolves.toBe(1);

    expect(repository.claimNextForDeletion).toHaveBeenNthCalledWith(1, {
      now: START,
      leaseExpiresAt: new Date('2026-08-12T00:10:00.000Z'),
    });
    expect(storage.delete).toHaveBeenCalledWith(
      'program-authoring/template-1',
    );
    expect(repository.markDeleted).toHaveBeenCalledWith(
      'tombstone-1',
      'claim-owner',
      START,
    );
  });

  it('stops claiming once no candidate remains', async () => {
    const { service, repository } = setup();
    repository.claimNextForDeletion.mockResolvedValueOnce(null);

    await expect(service.runDue()).resolves.toBe(0);
    expect(repository.claimNextForDeletion).toHaveBeenCalledTimes(1);
  });

  it('records a retry-scheduled failure when the storage delete rejects', async () => {
    const { service, repository, storage } = setup();
    repository.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);
    storage.delete.mockRejectedValueOnce(new Error('provider secret'));

    await service.runDue();

    expect(repository.recordDeleteFailure).toHaveBeenCalledWith({
      id: 'tombstone-1',
      claimOwner: 'claim-owner',
      attemptCount: 1,
      nextDeleteAttemptAt: new Date('2026-08-12T01:00:00.000Z'),
    });
  });

  it('leaves the sixth failure exhausted with no next attempt and alerts redacted data', async () => {
    const { service, repository, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    storage.delete.mockRejectedValueOnce(new Error('credential=do-not-log'));

    await service.runDue();

    expect(repository.recordDeleteFailure).toHaveBeenCalledWith({
      id: 'tombstone-1',
      claimOwner: 'claim-owner',
      attemptCount: 6,
      nextDeleteAttemptAt: null,
    });
    expect(alert).toHaveBeenCalledWith({
      event: 'program-purge-file.cleanup.exhausted',
      tombstoneId: 'tombstone-1',
      attemptCount: 6,
      error: 'storage_delete_failed',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('credential');
    alert.mockRestore();
  });

  it('does not alert when the claim was concurrently lost before failure was recorded', async () => {
    const { service, repository, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    repository.recordDeleteFailure.mockResolvedValueOnce(false);
    storage.delete.mockRejectedValueOnce(new Error('provider-secret'));

    await service.runDue();

    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
