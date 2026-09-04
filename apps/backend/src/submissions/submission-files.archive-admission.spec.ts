import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SUBMISSION_ZIP_REJECTION_MESSAGES } from './submission-zip-admission';
import { signatureValidZip } from './submission-zip-test-builder';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

const MIB = 1024 * 1024;

/** 전통 방식 암호화가 자료 앞에 덧붙이는 머리 크기. 이만큼을 더해야 진짜 암호화 자료다. */
const TRADITIONAL_ENCRYPTION_HEADER_BYTES = 12;

type ArchiveCase = {
  readonly scenario: string;
  /**
   * 이 압축 파일이 받아야 할 코드. `UNSUPPORTED_FILE_TYPE`(SUB_018)은 여기 없어야 한다 —
   * `.zip`은 허용 형식이고, 막힌 이유는 형식이 아니라 그 안에 담긴 것이다(#1108).
   */
  readonly code: SubmissionsErrorCode;
  readonly build: () => Buffer;
};

const HAZARDOUS_ARCHIVES = [
  {
    scenario: 'a relative traversal entry',
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
    build: () => signatureValidZip([{ name: '../outside.txt' }]),
  },
  {
    scenario: 'an absolute path entry',
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
    build: () => signatureValidZip([{ name: '/absolute.txt' }]),
  },
  {
    scenario: 'a backslash traversal entry',
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
    build: () => signatureValidZip([{ name: '..\\outside.txt' }]),
  },
  {
    scenario: 'an entry name containing NUL',
    code: SubmissionsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
    build: () => signatureValidZip([{ name: 'nul\u0000name.txt' }]),
  },
  {
    scenario: 'a Unix symlink entry',
    code: SubmissionsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
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
    code: SubmissionsErrorCode.ZIP_PASSWORD_PROTECTED,
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
    code: SubmissionsErrorCode.ZIP_UNSUPPORTED_COMPRESSION,
    build: () =>
      signatureValidZip([{ name: 'unsupported.txt', compressionMethod: 99 }]),
  },
  {
    scenario: 'a nested archive entry',
    code: SubmissionsErrorCode.ZIP_NESTED,
    build: () => signatureValidZip([{ name: 'nested.ZIP' }]),
  },
  {
    scenario: 'more than 1,000 entries',
    code: SubmissionsErrorCode.ZIP_TOO_MANY_ENTRIES,
    build: () =>
      signatureValidZip(
        Array.from({ length: 1_001 }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      ),
  },
  {
    scenario: 'one entry declaring more than 100 MiB',
    code: SubmissionsErrorCode.ZIP_CONTENT_TOO_LARGE,
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
    code: SubmissionsErrorCode.ZIP_CONTENT_TOO_LARGE,
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
    code: SubmissionsErrorCode.ZIP_EXPANDS_TOO_MUCH,
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
    code: SubmissionsErrorCode.ZIP_EXPANDS_TOO_MUCH,
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
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
    build: () => {
      const archive = signatureValidZip([{ name: 'malformed.txt' }]);
      archive.writeUInt32LE(0xffffffff, archive.byteLength - 6);
      return archive;
    },
  },
  {
    scenario: 'a truncated end-of-central-directory record',
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
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

  const rejection =
    upload?.status === 'rejected' && upload.reason instanceof DomainException
      ? upload.reason
      : null;

  return {
    code: rejection?.errorCode.code ?? null,
    domainRejected: rejection !== null,
    message: rejection?.errorCode.message ?? null,
    persistenceCalls: repository.createPending.mock.calls.length,
    status: upload?.status,
    storageCalls: storage.put.mock.calls.length,
  };
}

describe('SubmissionFilesService ZIP metadata admission', () => {
  it.each(HAZARDOUS_ARCHIVES)(
    'rejects $scenario with $code before persistence or storage',
    async ({ build, code }) => {
      // Given
      const archive = build();

      // When
      const outcome = await admissionOutcome(archive);

      // Then
      expect(outcome).toEqual({
        code,
        domainRejected: true,
        message: SUBMISSIONS_ERROR_CODES[code].message,
        persistenceCalls: 0,
        status: 'rejected',
        storageCalls: 0,
      });
    },
  );

  /**
   * #1108의 핵심 — 압축 안을 들여다본 뒤 막은 것과 형식·서명 때문에 막은 것은 서로 다른
   * 코드여야 한다. 하나로 뭉개면 허용 형식인 `.zip`을 낸 학생이 「지원하지 않는 파일
   * 형식입니다」를 읽고, 고칠 곳이 압축 안인데 형식만 다시 손보게 된다.
   */
  it.each(HAZARDOUS_ARCHIVES)(
    'does not answer $scenario with the unsupported-format code',
    async ({ build }) => {
      // Given
      const archive = build();

      // When
      const outcome = await admissionOutcome(archive);

      // Then
      expect(outcome.code).not.toBe(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
      expect(outcome.message).not.toBe('지원하지 않는 파일 형식입니다.');
      expect(Object.values(SUBMISSION_ZIP_REJECTION_MESSAGES)).toContain(
        outcome.message,
      );
    },
  );

  it('accepts a valid stored archive control', async () => {
    // Given
    const archive = signatureValidZip([{ name: 'valid.txt' }]);

    // When
    const outcome = await admissionOutcome(archive);

    // Then
    expect(outcome).toEqual({
      code: null,
      domainRejected: false,
      message: null,
      persistenceCalls: 1,
      status: 'fulfilled',
      storageCalls: 1,
    });
  });
});
