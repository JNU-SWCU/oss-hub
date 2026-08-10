import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import type { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';

const NOW = new Date('2026-08-10T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-11T00:00:00.000Z');
const ACTOR_ID = 'synthetic-authoring-actor';

function uploadFile(): ProgramAuthoringUploadFile {
  const buffer = Buffer.alloc(64);
  Buffer.from('%PDF-').copy(buffer);
  return {
    buffer,
    originalname: 'folder/plan.pdf',
    mimetype: 'application/pdf',
    size: buffer.byteLength,
  };
}

function setup() {
  const repository: jest.Mocked<
    Pick<ProgramAuthoringUploadRepository, 'createPending' | 'requestDelete'>
  > = {
    createPending: jest.fn().mockResolvedValue({
      id: 'upload-id',
      originalFileName: 'plan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 64,
      expiresAt: EXPIRES_AT,
    }),
    requestDelete: jest.fn().mockResolvedValue({ kind: 'QUEUED' }),
  };
  const storage: jest.Mocked<
    Pick<SubmissionFileStoragePort, 'put' | 'delete'>
  > = {
    put: jest.fn().mockResolvedValue({
      objectKey: 'unused-provider-key',
      originalName: 'plan.pdf',
      contentLength: 64,
      contentType: 'application/pdf',
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    storage,
    service: new ProgramAuthoringUploadService(repository, storage, () => NOW),
  };
}

describe('ProgramAuthoringUploadService', () => {
  it('inserts PENDING before PUT and returns only safe response metadata', async () => {
    // Given
    const { repository, storage, service } = setup();

    // When
    const result = await service.upload(ACTOR_ID, uploadFile());

    // Then
    const pending = repository.createPending.mock.calls[0]?.[0];
    expect(pending).toMatchObject({
      actorId: ACTOR_ID,
      originalFileName: 'plan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 64,
      expiresAt: EXPIRES_AT,
    });
    expect(pending?.storageKey).toMatch(
      /^program-authoring\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(pending?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.createPending.mock.invocationCallOrder[0]).toBeLessThan(
      storage.put.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: pending?.storageKey }),
    );
    expect(result).toEqual({
      id: 'upload-id',
      fileName: 'plan.pdf',
      contentType: 'application/pdf',
      size: 64,
      expiresAt: EXPIRES_AT.toISOString(),
    });
    expect(Object.keys(result).sort()).toEqual([
      'contentType',
      'expiresAt',
      'fileName',
      'id',
      'size',
    ]);
  });

  it.each(['', ' actor-with-spaces '])(
    'rejects an invalid server-resolved actor id before persistence',
    async (actorId) => {
      // Given
      const { repository, service } = setup();

      // When / Then
      await expect(service.upload(actorId, uploadFile())).rejects.toMatchObject({
        code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      });
      expect(repository.createPending).not.toHaveBeenCalled();
    },
  );

  it('keeps the inserted row cleanup-eligible when PUT fails and conceals provider details', async () => {
    // Given
    const { repository, storage, service } = setup();
    storage.put.mockRejectedValueOnce(
      new Error('provider credential and bucket detail'),
    );

    // When
    const failure = service.upload(ACTOR_ID, uploadFile());

    // Then
    await expect(failure).rejects.toMatchObject({
      code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.STORAGE_UNAVAILABLE,
      message: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
    expect(repository.createPending).toHaveBeenCalledTimes(1);
    await expect(failure.catch((error: unknown) => JSON.stringify(error))).resolves.not.toContain(
      'credential',
    );
  });

  it.each(['QUEUED', 'IDEMPOTENT'] as const)(
    'treats owner delete result %s as success without synchronously deleting storage',
    async (kind) => {
      // Given
      const { repository, storage, service } = setup();
      repository.requestDelete.mockResolvedValueOnce({ kind });

      // When / Then
      await expect(service.delete(ACTOR_ID, 'upload-id')).resolves.toBeUndefined();
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it('conceals missing and foreign uploads behind the same not-found signal', async () => {
    // Given
    const { repository, service } = setup();
    repository.requestDelete.mockResolvedValueOnce({ kind: 'NOT_FOUND' });

    // When / Then
    await expect(service.delete(ACTOR_ID, 'foreign-id')).rejects.toMatchObject({
      code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.NOT_FOUND,
    });
  });

  it('signals a conflict when the aggregate already attached the upload', async () => {
    // Given
    const { repository, service } = setup();
    repository.requestDelete.mockResolvedValueOnce({ kind: 'ATTACHED' });

    // When / Then
    await expect(service.delete(ACTOR_ID, 'upload-id')).rejects.toMatchObject({
      code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.ATTACHED_CONFLICT,
    });
  });
});
