import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
  type StoreSubmissionFileInput,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import {
  type CreatePendingSubmissionFileInput,
  SubmissionFileRetentionUnavailableError,
  type SubmissionFilesRepository,
} from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const PROGRAM_END = new Date('2027-02-28T09:30:00.000Z');

function setup() {
  const repository = {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue('student-opaque'),
    findUploadAuthorization: jest.fn().mockResolvedValue({
      uploaderId: 'student-opaque',
      applicationId: 'application-opaque',
      milestoneId: 'milestone-opaque',
      applicationApproved: true,
      submissionType: MilestoneSubmissionType.FILE,
      dueAt: new Date('2026-07-26T00:00:00.000Z'),
      programEndAt: PROGRAM_END,
    }),
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
  const buffer = Buffer.alloc(size);
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
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
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it.each([
    ['document.pdf', 'application/pdf'],
    ['document.hwp', 'application/x-hwp'],
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
    const exact = 50 * 1024 * 1024;
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

  it('rejects upload when Program end is null without putting an object', async () => {
    const { service, repository, storage } = setup();
    repository.findUploadAuthorization.mockResolvedValue({
      applicationApproved: true,
      submissionType: MilestoneSubmissionType.FILE,
      dueAt: new Date('2026-07-26T00:00:00.000Z'),
      programEndAt: null,
    });
    await expectCode(
      service.upload(1n, 'app', 'milestone', file()),
      SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE,
    );
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

  it('preserves retention-unavailable semantics when the locked Program has no end date', async () => {
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
    ['archive.zip', 'application/zip', Buffer.from([0x50, 0x4b, 0x05, 0x06])],
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
});
