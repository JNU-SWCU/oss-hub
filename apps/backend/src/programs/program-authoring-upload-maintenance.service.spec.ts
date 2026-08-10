import { Logger } from '@nestjs/common';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import type { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';

const NOW = new Date('2026-08-10T00:00:00.000Z');

function claimed(deleteAttemptCount: number) {
  return {
    id: 'upload-id',
    storageKey: 'program-authoring/server-key',
    deleteAttemptCount,
    claimOwner: 'unique-claim-owner',
  };
}

function setup() {
  const repository: jest.Mocked<
    Pick<
      ProgramAuthoringUploadRepository,
      'claimForDeletion' | 'markDeleted' | 'recordDeleteFailure'
    >
  > = {
    claimForDeletion: jest.fn().mockResolvedValue([]),
    markDeleted: jest.fn().mockResolvedValue(true),
    recordDeleteFailure: jest.fn().mockResolvedValue(true),
  };
  const storage: jest.Mocked<Pick<SubmissionFileStoragePort, 'delete'>> = {
    delete: jest.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    storage,
    service: new ProgramAuthoringUploadMaintenanceService(
      repository,
      storage,
      () => NOW,
    ),
  };
}

describe('ProgramAuthoringUploadMaintenanceService', () => {
  it('claims at most 100 rows with a ten-minute lease and marks successful deletes', async () => {
    // Given
    const { repository, storage, service } = setup();
    repository.claimForDeletion.mockResolvedValueOnce([claimed(0)]);

    // When
    const processed = await service.runDue(1_000);

    // Then
    expect(processed).toBe(1);
    expect(repository.claimForDeletion).toHaveBeenCalledWith({
      now: NOW,
      leaseExpiresAt: new Date('2026-08-10T00:10:00.000Z'),
      limit: 100,
    });
    expect(storage.delete).toHaveBeenCalledWith(
      'program-authoring/server-key',
    );
    expect(repository.markDeleted).toHaveBeenCalledWith(
      'upload-id',
      'unique-claim-owner',
      NOW,
    );
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 4],
    [3, 8],
    [4, 24],
  ])(
    'schedules prior attempt %i using the %ih retry delay',
    async (priorAttempts, delayHours) => {
      // Given
      const { repository, storage, service } = setup();
      repository.claimForDeletion.mockResolvedValueOnce([
        claimed(priorAttempts),
      ]);
      storage.delete.mockRejectedValueOnce(new Error('provider detail'));

      // When
      await service.runDue();

      // Then
      expect(repository.recordDeleteFailure).toHaveBeenCalledWith({
        id: 'upload-id',
        claimOwner: 'unique-claim-owner',
        attemptCount: priorAttempts + 1,
        nextAttemptAt: new Date(
          NOW.getTime() + delayHours * 60 * 60 * 1_000,
        ),
        errorCode: 'STORAGE_DELETE_FAILED',
      });
    },
  );

  it('keeps a non-null due timestamp at the sixth failure while making it exhausted', async () => {
    // Given
    const { repository, storage, service } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository.claimForDeletion.mockResolvedValueOnce([claimed(5)]);
    storage.delete.mockRejectedValueOnce(
      new Error('provider-secret=must-not-leak'),
    );

    // When
    await service.runDue();

    // Then
    expect(repository.recordDeleteFailure).toHaveBeenCalledWith({
      id: 'upload-id',
      claimOwner: 'unique-claim-owner',
      attemptCount: 6,
      nextAttemptAt: NOW,
      errorCode: 'STORAGE_DELETE_FAILED',
    });
    expect(alert).toHaveBeenCalledWith({
      event: 'program-authoring-upload.cleanup.exhausted',
      uploadId: 'upload-id',
      attemptCount: 6,
      errorCode: 'STORAGE_DELETE_FAILED',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('provider-secret');
    alert.mockRestore();
  });

  it('does not report exhaustion when a stale owner loses the failure CAS', async () => {
    // Given
    const { repository, storage, service } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository.claimForDeletion.mockResolvedValueOnce([claimed(5)]);
    repository.recordDeleteFailure.mockResolvedValueOnce(false);
    storage.delete.mockRejectedValueOnce(new Error('provider detail'));

    // When
    await service.runDue();

    // Then
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
