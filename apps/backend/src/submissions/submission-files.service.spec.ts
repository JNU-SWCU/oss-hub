import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { DomainException } from '../common/error-code';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
  type StoreSubmissionFileInput,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import {
  type CreatePendingSubmissionFileInput,
  type DownloadableSubmissionFile,
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
  type SubmissionFilesRepository,
} from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { signatureValidZip } from './submission-zip-test-builder';
import { SubmissionsErrorCode } from './submissions-error-code.enum';

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
    applicationApproved: true,
    submissionType: MilestoneSubmissionType.FILE,
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
      .fn<
        ReturnType<SubmissionFileStoragePort['put']>,
        [StoreSubmissionFileInput]
      >()
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
      .fn<ReturnType<SubmissionFileStoragePort['get']>, [string]>()
      .mockResolvedValue(Readable.from(Buffer.from('private-file-body'))),
  };
  const service = new SubmissionFilesService(
    repository as unknown as SubmissionFilesRepository,
    storage,
  );
  return { service, repository, storage };
}

const FILE_SIGNATURES: Readonly<Record<string, Buffer>> = {
  pdf: Buffer.from('%PDF-'),
  hwp: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  jpg: Buffer.from([0xff, 0xd8, 0xff]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
};

function file(name = 'report.pdf', type = 'application/pdf', size = 8) {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'zip') {
    const entryName = 'valid.txt';
    const metadataBytes = 30 + 46 + 22 + 2 * entryName.length;
    const buffer = signatureValidZip([
      {
        name: entryName,
        compressedSize: Math.max(1, size - metadataBytes),
      },
    ]);
    return {
      buffer,
      originalname: name,
      mimetype: type,
      size: buffer.byteLength,
    };
  }
  const buffer = Buffer.alloc(size);
  FILE_SIGNATURES[extension]?.copy(buffer);
  return {
    buffer,
    originalname: name,
    mimetype: type,
    size,
  };
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

  it.each([
    ['document.pdf', 'application/pdf'],
    ['document.hwp', 'application/x-hwp'],
    ['document.hwp', 'application/haansofthwp'],
    ['document.hwp', 'application/vnd.hancom.hwp'],
    ['document.hwp', 'application/x-hwp-v5'],
    ['document.hwp', 'application/octet-stream'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['image.png', 'image/png'],
    ['archive.zip', 'application/zip'],
    ['UPPER.PDF', 'APPLICATION/PDF'],
  ])('accepts the supported %s and %s pair', async (name, type) => {
    const { service, storage } = setup();
    await expect(
      service.upload(1n, 'app:id', 'milestone:id', file(name, type)),
    ).resolves.toMatchObject({
      fileId: 'file-opaque',
      fileName: name,
      contentType: type,
    });
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('restores a multipart latin1 mojibake filename before validation and storage', async () => {
    const { service, repository, storage } = setup();
    const mojibake = Buffer.from('제출-양식.pdf', 'utf8').toString('latin1');

    await expect(
      service.upload(
        1n,
        'app:id',
        'milestone:id',
        file(mojibake, 'application/pdf'),
      ),
    ).resolves.toMatchObject({ fileName: '제출-양식.pdf' });
    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ originalFileName: '제출-양식.pdf' }),
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: '제출-양식.pdf' }),
    );
  });

  it('allows an initial upload at the exact milestone deadline', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(
      authorization({ dueAt: NOW }),
    );

    await expect(
      service.upload(1n, 'app', 'milestone', file()),
    ).resolves.toMatchObject({ fileId: 'file-opaque' });

    expect(repository.createPending).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalled();
  });

  it.each([
    ['report.pdf', 'image/png'],
    ['report.exe', 'application/pdf'],
    ['no-extension', 'application/pdf'],
    ['.pdf', 'application/pdf'],
  ])('rejects mismatched or unsupported pair %s and %s', async (name, type) => {
    const { service, storage } = setup();
    await expectCode(
      service.upload(1n, 'app', 'milestone', file(name, type)),
      SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('accepts exactly 50 MiB and rejects one byte more', async () => {
    const exact = 5 * 1024 * 1024;
    const accepted = setup();
    await expect(
      accepted.service.upload(
        1n,
        'app',
        'milestone',
        file('archive.zip', 'application/zip', exact),
      ),
    ).resolves.toBeDefined();

    const rejected = setup();
    await expectCode(
      rejected.service.upload(
        1n,
        'app',
        'milestone',
        file('archive.zip', 'application/zip', exact + 1),
      ),
      SubmissionsErrorCode.FILE_TOO_LARGE,
    );
    expect(rejected.storage.put).not.toHaveBeenCalled();
  });

  it('preserves opaque application and milestone IDs through authorization and persistence', async () => {
    const { service, repository } = setup();
    await service.upload(
      123n,
      'application:opaque/01',
      'milestone:opaque/02',
      file(),
    );
    expect(repository.findUploadAuthorization).toHaveBeenCalledWith(
      'student-opaque',
      'application:opaque/01',
      'milestone:opaque/02',
      null,
    );
    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'application:opaque/01',
        milestoneId: 'milestone:opaque/02',
      }),
    );
  });

  it('completes authorization before putting private object data', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(null);
    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.NOT_APPLICATION_MEMBER,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('allows a CHANGES_REQUESTED replacement upload after the milestone deadline', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(
      authorization({
        dueAt: new Date('2026-07-24T00:00:00.000Z'),
        resubmissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        currentRevision: 1,
      }),
    );

    await expect(
      service.upload(1n, 'app', 'milestone', file(), 'submission-opaque', '1'),
    ).resolves.toMatchObject({ fileId: 'file-opaque' });

    expect(repository.findUploadAuthorization).toHaveBeenCalledWith(
      'student-opaque',
      'app',
      'milestone',
      { submissionId: 'submission-opaque', baseRevision: 1 },
    );
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('requires submissionId and baseRevision to be paired', async () => {
    const { service, repository, storage } = setup();

    await expectCode(
      service.upload(1n, 'app', 'milestone', file(), 'submission-opaque'),
      SubmissionsErrorCode.INVALID_FILE_UPLOAD,
    );

    expect(repository.findUploadAuthorization).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects mismatched replacement upload context before storage', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(null);

    await expectCode(
      service.upload(1n, 'app', 'milestone', file(), 'other-submission', '1'),
      SubmissionsErrorCode.NOT_APPLICATION_MEMBER,
    );

    expect(repository.findUploadAuthorization).toHaveBeenCalledWith(
      'student-opaque',
      'app',
      'milestone',
      { submissionId: 'other-submission', baseRevision: 1 },
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  // 마감 전 SUBMITTED 교체는 허용한다 — 체크리스트가 canResubmit=true 로 안내하는 경로이며,
  // 여기서만 막으면 FILE 유형 학생은 잘못 낸 파일을 마감 전에 고칠 수 없다.
  it('allows a SUBMITTED replacement upload before the milestone deadline', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(
      authorization({
        resubmissionStatus: SubmissionStatus.SUBMITTED,
        currentRevision: 1,
        dueAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
    );

    await service.upload(
      1n,
      'app',
      'milestone',
      file(),
      'submission-opaque',
      '1',
    );

    expect(repository.createPending).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalled();
  });

  it('rejects a SUBMITTED replacement upload after the milestone deadline', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(
      authorization({
        resubmissionStatus: SubmissionStatus.SUBMITTED,
        currentRevision: 1,
        dueAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );

    await expectCode(
      service.upload(1n, 'app', 'milestone', file(), 'submission-opaque', '1'),
      SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED,
    );

    expect(repository.createPending).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each([SubmissionStatus.APPROVED, SubmissionStatus.REJECTED])(
    'rejects a %s replacement upload regardless of the deadline',
    async (status) => {
      const { service, repository, storage } = setup();
      repository.findUploadAuthorization.mockResolvedValue(
        authorization({
          resubmissionStatus: status,
          currentRevision: 1,
          dueAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
      );

      await expectCode(
        service.upload(
          1n,
          'app',
          'milestone',
          file(),
          'submission-opaque',
          '1',
        ),
        SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED,
      );

      expect(repository.createPending).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    },
  );

  it('rejects stale replacement upload context before storage', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue(
      authorization({
        resubmissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        currentRevision: 2,
      }),
    );

    await expectCode(
      service.upload(1n, 'app', 'milestone', file(), 'submission-opaque', '1'),
      SubmissionsErrorCode.STALE_SUBMISSION_REVISION,
    );

    expect(repository.createPending).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each([
    ['unsafe number', Number.MAX_SAFE_INTEGER + 1],
    ['unsafe digit string', '9007199254740992'],
    ['huge digit string', '123456789012345678901234567890'],
  ])('rejects %s baseRevision before authorization', async (_label, value) => {
    const { service, repository, storage } = setup();

    await expectCode(
      service.upload(
        1n,
        'app',
        'milestone',
        file(),
        'submission-opaque',
        value,
      ),
      SubmissionsErrorCode.INVALID_FILE_UPLOAD,
    );

    expect(repository.findUploadAuthorization).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('redacts provider storage failures behind the public domain error', async () => {
    const { service, storage } = setup();
    storage.put.mockRejectedValue(
      new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED,
      ),
    );
    const error = await service
      .upload(1n, 'app', 'milestone', file())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).errorCode.code).toBe(
      SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    );
    expect((error as Error).message).not.toContain('SUBMISSION_FILE_STORAGE');
  });
  it('maps unexpected storage adapter failures to the same public error', async () => {
    const { service, storage } = setup();
    storage.put.mockRejectedValue(new Error('unexpected adapter failure'));

    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    );
  });

  it('uses upload time for the pending clock and delegates retention to the reservation transaction', async () => {
    const { service, repository } = setup();
    await service.upload(1n, 'app', 'milestone', file());
    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingExpiresAt: new Date('2026-07-26T12:00:00.000Z'),
      }),
    );
    expect(repository.createPending.mock.calls[0]?.[0]).not.toHaveProperty(
      'expiresAt',
    );
  });

  it('preserves retention-unavailable semantics when the locked Program row is missing', async () => {
    const { service, repository, storage } = setup();
    repository.createPending.mockRejectedValue(
      new SubmissionFileRetentionUnavailableError(),
    );

    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('maps a quota reservation failure to the deliberate 413 domain error', async () => {
    const { service, repository, storage } = setup();
    repository.createPending.mockRejectedValue(
      new SubmissionFileQuotaExceededError(),
    );

    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does not put an object when the pending reservation fails', async () => {
    const { service, repository, storage } = setup();
    repository.createPending.mockRejectedValue(new Error('database detail'));
    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('leaves durable pending cleanup state when the put fails', async () => {
    const { service, repository, storage } = setup();
    storage.put.mockRejectedValue(
      new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED,
      ),
    );
    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    );
    const failedReservation = repository.createPending.mock.calls.at(-1)?.[0];
    expect(failedReservation?.storageKey).toMatch(/^submission-files\//);
    expect(failedReservation?.pendingExpiresAt).toEqual(
      new Date('2026-07-26T12:00:00.000Z'),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('reserves the assigned key before put and only then returns its file id', async () => {
    const { service, repository, storage } = setup();
    await expect(
      service.upload(1n, 'app', 'milestone', file()),
    ).resolves.toMatchObject({ fileId: 'file-opaque' });
    const reservation = repository.createPending.mock.calls.at(0)?.[0];
    if (reservation === undefined) {
      throw new Error('Expected a pending file reservation.');
    }
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: reservation.storageKey,
        originalName: reservation.originalFileName,
      }),
    );
    const reservationOrder =
      repository.createPending.mock.invocationCallOrder.at(0);
    const putOrder = storage.put.mock.invocationCallOrder.at(0);
    if (reservationOrder === undefined || putOrder === undefined) {
      throw new Error('Expected reservation and storage calls.');
    }
    expect(reservationOrder).toBeLessThan(putOrder);
  });

  it.each([
    ['report.pdf', 'application/pdf', Buffer.from('%PDF-')],
    [
      'report.hwp',
      'application/x-hwp',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    [
      'image.png',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    [
      'archive.zip',
      'application/zip',
      signatureValidZip([{ name: 'valid.txt' }]),
    ],
  ])(
    'accepts the exact byte-signature boundary for %s',
    async (name, type, buffer) => {
      const { service, storage } = setup();
      await expect(
        service.upload(1n, 'app', 'milestone', {
          buffer,
          originalname: name,
          mimetype: type,
          size: buffer.length,
        }),
      ).resolves.toBeDefined();
      expect(storage.put).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['report.pdf', 'application/pdf', Buffer.from('%PDF')],
    [
      'report.hwp',
      'application/x-hwp',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a]),
    ],
    ['photo.jpeg', 'image/jpeg', Buffer.from([0xff, 0xd8])],
    [
      'image.png',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]),
    ],
    ['archive.zip', 'application/zip', Buffer.from([0x50, 0x4b, 0x03])],
  ])(
    'rejects a truncated or spoofed byte signature for %s',
    async (name, type, buffer) => {
      const { service, repository, storage } = setup();
      await expectCode(
        service.upload(1n, 'app', 'milestone', {
          buffer,
          originalname: name,
          mimetype: type,
          size: buffer.length,
        }),
        SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE,
      );
      expect(repository.createPending).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    },
  );

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

  it('maps download storage failures to the public unavailable error', async () => {
    const { service, storage } = setup();
    storage.get.mockRejectedValue(
      new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED,
      ),
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
      new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_NOT_FOUND,
      ),
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
