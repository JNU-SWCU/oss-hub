import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionFileAdmissionService, MAX_FILE_BYTES, SubmissionFilesService } from './files.service';
import { DownloadResponseService } from './download-response.service';
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import { type StoreObjectInput, type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from '../platform/object-storage.error';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import { SubmissionFileQuotaExceededError, SubmissionFileRetentionUnavailableError } from './files.error';
import { type CreatePendingSubmissionFileInput, type DownloadableSubmissionFile, type SubmissionFilesRepository } from './files.repository';
import { SUBMISSIONS_ERROR_CODES, SubmissionsErrorCode } from './submissions-error-code.error';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const PROGRAM_END = new Date('2027-02-28T09:30:00.000Z');
function authorization(
  overrides: Partial<{
    readonly applicationApproved: boolean;
    readonly submissionType: MilestoneSubmissionType;
    readonly dueAt: Date;
    readonly programEndAt: Date;
    readonly resubmissionStatus: SubmissionStatus;
    readonly currentRevision: number;
  }> = {},
) {
  return {
    uploaderId: 'student-opaque',
    applicationId: 'application-opaque',
    milestoneId: 'milestone-opaque',
    milestoneDocumentId: 'requirement-opaque',
    applicationApproved: true,
    dueAt: new Date('2026-07-26T00:00:00.000Z'),
    programEndAt: PROGRAM_END,
    ...overrides,
  };
}
function setup() {
  const repository = {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue('student-opaque'),
    findUploadAuthorization: jest.fn().mockResolvedValue(authorization()),
    createPending: jest
      .fn<
        Promise<{
          id: string;
          originalFileName: string;
          mimeType: string;
          sizeBytes: number;
          expiresAt: Date;
        }>,
        [CreatePendingSubmissionFileInput]
      >()
      .mockImplementation((input) =>
        Promise.resolve({
          id: 'file-opaque',
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          expiresAt: new Date('2028-02-28T09:30:00.000Z'),
        }),
      ),
    findDownloadableFile: jest
      .fn<Promise<DownloadableSubmissionFile | null>, [bigint, string, Date]>()
      .mockResolvedValue({
        id: 'file-opaque',
        storageKey: 'submission-files/private-key',
        originalFileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 14,
        expiresAt: new Date('2028-02-28T09:30:00.000Z'),
      }),
  };
  const storage = {
    put: jest
      .fn<ReturnType<ObjectStoragePort['put']>, [StoreObjectInput]>()
      .mockImplementation((input) =>
        Promise.resolve({
          objectKey: input.objectKey ?? 'private/opaque-object',
          originalName: input.originalName,
          contentLength: input.body.byteLength,
          contentType: input.contentType,
        }),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
    get: jest
      .fn<ReturnType<ObjectStoragePort['get']>, [string]>()
      .mockResolvedValue(Readable.from(Buffer.from('private-file-body'))),
  };
  const service = new SubmissionFilesService(
    repository as unknown as SubmissionFilesRepository,
    storage,
    new ProgramScheduleService(),
    new SubmissionFileAdmissionService(),
    new DownloadResponseService(),
  );
  return { service, repository, storage };
}
async function expectCode(
  promise: Promise<unknown>,
  code: SubmissionsErrorCode,
) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).errorCode.code).toBe(code);
}
describe('SubmissionFilesService', () => {
  beforeEach(() =>
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }).setSystemTime(NOW),
  );
  afterEach(() => jest.useRealTimers());
  it('creates a pending file without uploading storage objects or changing its result', async () => {
    const { service, repository, storage } = setup();
    const input: Omit<CreatePendingSubmissionFileInput, 'resolveExpiresAt'> = {
      uploaderId: 'student-opaque',
      applicationId: 'app-opaque',
      milestoneId: 'milestone-opaque',
      milestoneDocumentId: 'requirement-opaque',
      storageKey: 'submission-files/pending-key',
      originalFileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 14,
      pendingExpiresAt: new Date('2026-07-26T12:00:00.000Z'),
    };
    const result = {
      id: 'file-opaque',
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt: PROGRAM_END,
    };
    repository.createPending.mockResolvedValueOnce(result);
    await expect(service.createPending(input)).resolves.toBe(result);
    expect(repository.createPending).toHaveBeenCalledTimes(1);
    expect(repository.createPending.mock.calls[0]?.[0]).toMatchObject(input);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it.each([
    new SubmissionMembershipChangedError('app-opaque', 'student-opaque'),
    new SubmissionFileQuotaExceededError(),
    new SubmissionFileRetentionUnavailableError(),
    new Error('database unavailable'),
  ])(
    'preserves pending creation error identity for caller mapping: %s',
    async (failure) => {
      const { service, repository, storage } = setup();
      repository.createPending.mockRejectedValueOnce(failure);
      await expect(
        service.createPending({
          uploaderId: 'student-opaque',
          applicationId: 'app-opaque',
          milestoneId: 'milestone-opaque',
      milestoneDocumentId: 'requirement-opaque',
          storageKey: 'submission-files/pending-key',
          originalFileName: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 14,
          pendingExpiresAt: NOW,
        }),
      ).rejects.toBe(failure);
      expect(repository.createPending).toHaveBeenCalledTimes(1);
      expect(storage.put).not.toHaveBeenCalled();
    },
  );
  it('states the enforced limit in the SUB_019 message', () => {
    expect(
      SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.FILE_TOO_LARGE].message,
    ).toBe(`파일은 ${MAX_FILE_BYTES / 1024 / 1024} MB 이하여야 합니다.`);
  });
  it('streams an authorized attached file with safe metadata', async () => {
    const { service, repository, storage } = setup();
    const download = await service.download(123n, 'file-opaque');
    expect(repository.findDownloadableFile).toHaveBeenCalledWith(
      123n,
      'file-opaque',
      NOW,
    );
    expect(storage.get).toHaveBeenCalledWith('submission-files/private-key');
    expect(download).toMatchObject({
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      contentLength: 14,
    });
  });
  it('returns indistinguishable not-found without reading storage when access is denied', async () => {
    const { service, repository, storage } = setup();
    repository.findDownloadableFile.mockResolvedValue(null);
    await expectCode(
      service.download(123n, 'file-opaque'),
      SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('denies a departed uploader with the same not-found used for a missing file', async () => {
    const { service, repository, storage } = setup();
    repository.findDownloadableFile.mockResolvedValue(null);
    const departed = await service
      .download(123n, 'file-opaque')
      .catch((caught: unknown) => caught);
    const missing = await service
      .download(123n, 'file-missing')
      .catch((caught: unknown) => caught);
    expect((departed as DomainException).errorCode).toEqual(
      (missing as DomainException).errorCode,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('maps download storage failures to the public unavailable error', async () => {
    const { service, storage } = setup();
    storage.get.mockRejectedValue(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_FAILED),
    );
    const error = await service
      .download(123n, 'file-opaque')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).errorCode.code).toBe(
      SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    );
    expect((error as Error).message).not.toContain('SUBMISSION_FILE_STORAGE');
  });
  it('maps missing download storage objects to the established not-found error', async () => {
    const { service, storage } = setup();
    storage.get.mockRejectedValue(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_NOT_FOUND),
    );
    await expectCode(
      service.download(123n, 'file-opaque'),
      SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND,
    );
  });
  it('falls back to octet-stream for unsafe stored content types', async () => {
    const { service, repository } = setup();
    repository.findDownloadableFile.mockResolvedValue({
      id: 'file-opaque',
      storageKey: 'submission-files/private-key',
      originalFileName: 'report.html',
      mimeType: 'text/html',
      sizeBytes: 14,
      expiresAt: new Date('2028-02-28T09:30:00.000Z'),
    });
    await expect(service.download(123n, 'file-opaque')).resolves.toMatchObject({
      contentType: 'application/octet-stream',
    });
  });
});
