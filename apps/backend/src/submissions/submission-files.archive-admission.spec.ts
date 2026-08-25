import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { signatureValidZip } from './submission-zip-test-builder';

const MIB = 1024 * 1024;

type ArchiveCase = {
  readonly scenario: string;
  readonly build: () => Buffer;
};

const HAZARDOUS_ARCHIVES = [
  {
    scenario: 'a relative traversal entry',
    build: () => signatureValidZip([{ name: '../outside.txt' }]),
  },
  {
    scenario: 'an absolute path entry',
    build: () => signatureValidZip([{ name: '/absolute.txt' }]),
  },
  {
    scenario: 'a backslash traversal entry',
    build: () => signatureValidZip([{ name: '..\\outside.txt' }]),
  },
  {
    scenario: 'an entry name containing NUL',
    build: () => signatureValidZip([{ name: 'nul\u0000name.txt' }]),
  },
  {
    scenario: 'a Unix symlink entry',
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
    build: () => signatureValidZip([{ name: 'encrypted.txt', flags: 0x0001 }]),
  },
  {
    scenario: 'an unsupported compression method',
    build: () =>
      signatureValidZip([{ name: 'unsupported.txt', compressionMethod: 99 }]),
  },
  {
    scenario: 'a nested archive entry',
    build: () => signatureValidZip([{ name: 'nested.ZIP' }]),
  },
  {
    scenario: 'more than 1,000 entries',
    build: () =>
      signatureValidZip(
        Array.from({ length: 1_001 }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      ),
  },
  {
    scenario: 'one entry declaring more than 100 MiB',
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
    build: () =>
      signatureValidZip([
        {
          name: 'entry-ratio.txt',
          compressionMethod: 8,
          compressedSize: 1_024,
          uncompressedSize: 101 * 1_024,
        },
      ]),
  },
  {
    scenario: 'an aggregate compression ratio over 100:1',
    build: () =>
      signatureValidZip(
        Array.from({ length: 3 }, (_, index) => ({
          name: `aggregate-ratio-${index}.txt`,
          compressionMethod: 8,
          compressedSize: 1_024,
          uncompressedSize: 103 * 1_024,
        })),
      ),
  },
  {
    scenario: 'a malformed central-directory offset',
    build: () => {
      const archive = signatureValidZip([{ name: 'malformed.txt' }]);
      archive.writeUInt32LE(0xffffffff, archive.byteLength - 6);
      return archive;
    },
  },
  {
    scenario: 'a truncated end-of-central-directory record',
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
      submissionType: MilestoneSubmissionType.FILE,
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
  const service = new SubmissionFilesService(
    repository as unknown as SubmissionFilesRepository,
    storage,
  );
  return { repository, service, storage };
}

async function admissionOutcome(buffer: Buffer) {
  const { repository, service, storage } = setup();
  const [upload] = await Promise.allSettled([
    service.upload(1n, 'application-opaque', 'milestone-opaque', {
      buffer,
      originalname: 'archive.zip',
      mimetype: 'application/zip',
      size: buffer.byteLength,
    }),
  ]);

  return {
    domainRejected:
      upload?.status === 'rejected' && upload.reason instanceof DomainException,
    persistenceCalls: repository.createPending.mock.calls.length,
    status: upload?.status,
    storageCalls: storage.put.mock.calls.length,
  };
}

describe('SubmissionFilesService ZIP metadata admission', () => {
  it.each(HAZARDOUS_ARCHIVES)(
    'rejects $scenario before persistence or storage',
    async ({ build }) => {
      // Given
      const archive = build();

      // When
      const outcome = await admissionOutcome(archive);

      // Then
      expect(outcome).toEqual({
        domainRejected: true,
        persistenceCalls: 0,
        status: 'rejected',
        storageCalls: 0,
      });
    },
  );

  it('accepts a valid stored archive control', async () => {
    // Given
    const archive = signatureValidZip([{ name: 'valid.txt' }]);

    // When
    const outcome = await admissionOutcome(archive);

    // Then
    expect(outcome).toEqual({
      domainRejected: false,
      persistenceCalls: 1,
      status: 'fulfilled',
      storageCalls: 1,
    });
  });
});
