import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionFileAdmissionService, FilesService } from './files.service';
import { DownloadResponseService } from './download-response.service';
import { DomainException } from '../platform/error-code.error';
import { type FilesRepository } from './files.repository';
import { signatureValidZip } from './submission-zip-builder.fixture';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';

const MIB = 1024 * 1024;
const TRADITIONAL_ENCRYPTION_HEADER_BYTES = 12;
type ArchiveCase = {
  readonly scenario: string;
  readonly code: string;
  readonly build: () => Buffer;
};
const HAZARDOUS_ARCHIVES = [
  {
    scenario: 'a relative traversal entry',
    code: 'SUB_025',
    build: () => signatureValidZip([{ name: '../outside.txt' }]),
  },
  {
    scenario: 'an absolute path entry',
    code: 'SUB_025',
    build: () => signatureValidZip([{ name: '/absolute.txt' }]),
  },
  {
    scenario: 'a backslash traversal entry',
    code: 'SUB_025',
    build: () => signatureValidZip([{ name: '..\\outside.txt' }]),
  },
  {
    scenario: 'an entry name containing NUL',
    code: 'SUB_026',
    build: () => signatureValidZip([{ name: 'nul\u0000name.txt' }]),
  },
  {
    scenario: 'a Unix symlink entry',
    code: 'SUB_026',
    build: () =>
      signatureValidZip([
        {
          name: 'link.txt',
          versionMadeBy: 0x0314,
          externalAttributes: 0xa1ff0000,
        },
      ]),
  },
  {
    scenario: 'an encrypted entry flag',
    code: 'SUB_028',
    build: () =>
      signatureValidZip([
        {
          name: 'encrypted.txt',
          flags: 0x0001,
          compressedSize: 1 + TRADITIONAL_ENCRYPTION_HEADER_BYTES,
          uncompressedSize: 1,
        },
      ]),
  },
  {
    scenario: 'an unsupported compression method',
    code: 'SUB_029',
    build: () =>
      signatureValidZip([{ name: 'unsupported.txt', compressionMethod: 99 }]),
  },
  {
    scenario: 'a nested archive entry',
    code: 'SUB_027',
    build: () => signatureValidZip([{ name: 'nested.ZIP' }]),
  },
  {
    scenario: 'more than 1,000 entries',
    code: 'SUB_030',
    build: () =>
      signatureValidZip(
        Array.from({ length: 1001 }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      ),
  },
  {
    scenario: 'one entry declaring more than 100 MiB',
    code: 'SUB_031',
    build: () =>
      signatureValidZip([
        {
          name: 'entry-expansion.txt',
          compressionMethod: 8,
          compressedSize: 2 * MIB,
          uncompressedSize: 100 * MIB + 1,
        },
      ]),
  },
  {
    scenario: 'entries declaring more than 200 MiB in aggregate',
    code: 'SUB_031',
    build: () =>
      signatureValidZip(
        Array.from({ length: 3 }, (_, index) => ({
          name: `aggregate-${index}.txt`,
          compressionMethod: 8,
          compressedSize: MIB,
          uncompressedSize: 70 * MIB,
        })),
      ),
  },
  {
    scenario: 'one entry exceeding a 100:1 compression ratio',
    code: 'SUB_032',
    build: () =>
      signatureValidZip([
        {
          name: 'entry-ratio.txt',
          compressionMethod: 8,
          compressedSize: 1024,
          uncompressedSize: 101 * 1024,
        },
      ]),
  },
  {
    scenario: 'an aggregate compression ratio over 100:1',
    code: 'SUB_032',
    build: () =>
      signatureValidZip(
        Array.from({ length: 3 }, (_, index) => ({
          name: `aggregate-ratio-${index}.txt`,
          compressionMethod: 8,
          compressedSize: 1024,
          uncompressedSize: 103 * 1024,
        })),
      ),
  },
  {
    scenario: 'a malformed central-directory offset',
    code: 'SUB_025',
    build: () => {
      const archive = signatureValidZip([{ name: 'malformed.txt' }]);
      archive.writeUInt32LE(0xffffffff, archive.byteLength - 6);
      return archive;
    },
  },
  {
    scenario: 'a truncated end-of-central-directory record',
    code: 'SUB_025',
    build: () => {
      const archive = signatureValidZip([{ name: 'truncated.txt' }]);
      return archive.subarray(0, archive.byteLength - 1);
    },
  },
] satisfies readonly ArchiveCase[];
function setup() {
  const repository = {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue('student-opaque'),
    findUploadAuthorization: jest.fn().mockResolvedValue({
      uploaderId: 'student-opaque',
      applicationId: 'application-opaque',
      milestoneId: 'milestone-opaque',
      applicationApproved: true,
      dueAt: new Date('2099-01-01T00:00:00.000Z'),
      programEndAt: new Date('2099-12-31T00:00:00.000Z'),
      resubmissionStatus: null,
      currentRevision: null,
    }),
    createPending: jest.fn().mockResolvedValue({
      id: 'file-opaque',
      originalFileName: 'archive.zip',
      mimeType: 'application/zip',
      sizeBytes: 1,
      expiresAt: new Date('2100-12-31T00:00:00.000Z'),
    }),
  };
  const storage = {
    put: jest.fn().mockResolvedValue({
      objectKey: 'submission-files/private-object',
      originalName: 'archive.zip',
      contentLength: 1,
      contentType: 'application/zip',
    }),
    get: jest.fn(),
    delete: jest.fn(),
  };
  const service = new FilesService(
    repository as unknown as FilesRepository,
    storage,
    new ProgramScheduleService(),
    new SubmissionFileAdmissionService(),
    new DownloadResponseService(),
  );
  return { repository, service, storage };
}
async function checkOutcome(buffer: Buffer) {
  const { repository, service, storage } = setup();
  const [check] = await Promise.allSettled([
    service.check({
      buffer,
      originalname: 'archive.zip',
      mimetype: 'application/zip',
      size: buffer.byteLength,
    }),
  ]);
  const rejection =
    check?.status === 'rejected' && check.reason instanceof DomainException
      ? check.reason
      : null;
  const callCount = (mocks: Record<string, jest.Mock>) =>
    Object.values(mocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0);
  return {
    code: rejection?.errorCode.code ?? null,
    httpStatus: rejection?.errorCode.status ?? null,
    message: rejection?.errorCode.message ?? null,
    repositoryCalls: callCount(repository),
    status: check?.status,
    storageCalls: callCount(storage),
  };
}
describe('FilesService file check before submission', () => {
  it.each(HAZARDOUS_ARCHIVES)(
    'answers $scenario with the submission code $code and touches neither repository nor storage',
    async ({ build, code }) => {
      const archive = build();
      const checked = await checkOutcome(archive);
      expect(checked).toEqual({
        code,
        httpStatus: 422,
        message: SUBMISSIONS_ERROR_CODES[code as SubmissionsErrorCode].message,
        repositoryCalls: 0,
        status: 'rejected',
        storageCalls: 0,
      });
      expect(checked.code).toBe(code);
    },
  );
  it('passes a valid archive and still touches neither repository nor storage', async () => {
    const archive = signatureValidZip([{ name: 'valid.txt' }]);
    const outcome = await checkOutcome(archive);
    expect(outcome).toEqual({
      code: null,
      httpStatus: null,
      message: null,
      repositoryCalls: 0,
      status: 'fulfilled',
      storageCalls: 0,
    });
  });
});
