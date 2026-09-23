import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents/milestone-documents-error-code.enum';
import { MilestoneDocumentFilesService } from '../milestone-documents/milestone-document-files.service';
import type { MilestoneDocumentsRepository } from '../milestone-documents/milestone-documents.repository';
import type { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import {
  SubmissionZipRejection,
  type SubmissionZipRejection as SubmissionZipRejectionType,
} from './submission-zip-admission';
import { signatureValidZip } from './submission-zip-test-builder';
import {
  SUBMISSION_ZIP_REJECTION_ERROR_CODES,
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

// 합성 데이터만 사용한다 (docs/rules/security.md)

const MIB = 1024 * 1024;
const TRADITIONAL_ENCRYPTION_HEADER_BYTES = 12;
const UPLOAD_NOW = new Date('2026-09-01T00:00:00.000Z');

/**
 * 티켓이 헤아린 여섯 갈래를 **같은 압축 파일**로 두 경로에 동시에 넣는다.
 * 한쪽만 고치면 다른 쪽에 같은 증상이 남기 때문에, 표가 아니라 실제 업로드 경로로 확인한다.
 */
const ARCHIVES: ReadonlyArray<readonly [string, () => Buffer]> = [
  ['중첩 압축', () => signatureValidZip([{ name: 'nested.zip' }])],
  [
    '비밀번호',
    () =>
      signatureValidZip([
        {
          name: 'encrypted.txt',
          flags: 0x0001,
          compressedSize: 1 + TRADITIONAL_ENCRYPTION_HEADER_BYTES,
          uncompressedSize: 1,
        },
      ]),
  ],
  [
    '항목 수 초과',
    () =>
      signatureValidZip(
        Array.from({ length: 1_001 }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      ),
  ],
  [
    '용량 초과',
    () =>
      signatureValidZip([
        {
          name: 'entry-expansion.txt',
          compressionMethod: 8,
          compressedSize: 2 * MIB,
          uncompressedSize: 100 * MIB + 1,
        },
      ]),
  ],
  [
    '압축률 초과',
    () =>
      signatureValidZip([
        {
          name: 'entry-ratio.txt',
          compressionMethod: 8,
          compressedSize: 1_024,
          uncompressedSize: 101 * 1_024,
        },
      ]),
  ],
  [
    '지원하지 않는 압축 방식',
    () =>
      signatureValidZip([{ name: 'unsupported.txt', compressionMethod: 99 }]),
  ],
];

function submissionService() {
  const repository = {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue('student-opaque'),
    findUploadAuthorization: jest.fn().mockResolvedValue({
      applicationApproved: true,
      submissionType: MilestoneSubmissionType.FILE,
      dueAt: new Date('2099-01-01T00:00:00.000Z'),
      programEndAt: new Date('2099-12-31T00:00:00.000Z'),
      resubmissionStatus: null,
      currentRevision: null,
    }),
    createPending: jest.fn(),
  };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
  return new SubmissionFilesService(
    repository as unknown as SubmissionFilesRepository,
    storage,
  );
}

function milestoneDocumentService() {
  const repository = {
    findActiveUser: jest.fn().mockResolvedValue({
      id: 'user-opaque',
      hasStaffAccess: false,
      hasAdminAccess: false,
    }),
    findDocumentContext: jest.fn().mockResolvedValue({
      id: 'document-opaque',
      milestoneId: 'milestone-opaque',
      programId: 'program-opaque',
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2099-01-01T00:00:00.000Z'),
      required: true,
    }),
    findStudentApplication: jest.fn().mockResolvedValue({
      applicationId: 'application-opaque',
      approved: true,
      programEndAt: new Date('2099-12-31T00:00:00.000Z'),
    }),
    findMySubmission: jest.fn().mockResolvedValue(null),
    findLatestReview: jest.fn().mockResolvedValue(null),
  };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
  const submissionFiles = { createPending: jest.fn() };
  return new MilestoneDocumentFilesService(
    repository as unknown as MilestoneDocumentsRepository,
    storage,
    submissionFiles as unknown as SubmissionFilesRepository,
  );
}

async function rejectionCodeOf(promise: Promise<unknown>): Promise<string> {
  const [settled] = await Promise.allSettled([promise]);
  if (settled?.status !== 'rejected') {
    throw new Error('업로드가 거절되지 않았다');
  }
  if (!(settled.reason instanceof DomainException)) {
    throw settled.reason as Error;
  }
  return settled.reason.errorCode.code;
}

describe('제출 경로와 서류 경로는 같은 압축 파일에 같은 구분으로 답한다', () => {
  it.each(ARCHIVES)('%s', async (_scenario, build) => {
    // Given
    const archive = build();
    const file = {
      buffer: archive,
      originalname: '제출묶음.zip',
      mimetype: 'application/zip',
      size: archive.byteLength,
    };

    // When
    const submissionCode = await rejectionCodeOf(
      submissionService().upload(
        1n,
        'application-opaque',
        'milestone-opaque',
        file,
      ),
    );
    const documentCode = await rejectionCodeOf(
      milestoneDocumentService().upload(
        1n,
        'milestone-opaque',
        'document-opaque',
        file,
        UPLOAD_NOW,
      ),
    );

    // Then: 코드 문자열은 모듈마다 다르지만(SUB_*·MSD_*) 학생이 읽는 말과 상태는 같아야 한다.
    const submission =
      SUBMISSIONS_ERROR_CODES[submissionCode as SubmissionsErrorCode];
    const document =
      MILESTONE_DOCUMENTS_ERROR_CODES[
        documentCode as MilestoneDocumentsErrorCode
      ];
    expect(document.message).toBe(submission.message);
    expect(document.status).toBe(submission.status);
    expect(submissionCode).not.toBe(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    expect(documentCode).not.toBe(
      MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE,
    );
  });
});

describe('두 경로의 사유 표는 같은 갈래를 덮는다', () => {
  const reasons = Object.values(
    SubmissionZipRejection,
  ) as SubmissionZipRejectionType[];

  it('여덟 갈래 모두 양쪽에 코드가 있다', () => {
    // 코드 체계를 하나로 합치지 않는 대신(모듈이 자기 코드 공간을 소유한다) 빠짐이 없는지를
    // 여기서 확인한다. 타입도 같은 것을 강제하지만, 갈래가 늘었을 때 사람이 읽는 실패
    // 메시지가 있는 편이 낫다.
    for (const reason of reasons) {
      expect(SUBMISSION_ZIP_REJECTION_ERROR_CODES[reason]).toBeDefined();
      expect(
        MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[reason],
      ).toBeDefined();
    }
  });

  it.each(
    Object.values(SubmissionZipRejection) as SubmissionZipRejectionType[],
  )('%s의 문구와 상태가 두 경로에서 같다', (reason) => {
    // Given
    const submission =
      SUBMISSIONS_ERROR_CODES[SUBMISSION_ZIP_REJECTION_ERROR_CODES[reason]];
    const document =
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[reason]
      ];

    // Then
    expect(document.message).toBe(submission.message);
    expect(document.status).toBe(submission.status);
    expect(submission.status).toBe(422);
  });

  it('갈래마다 서로 다른 코드를 쓴다', () => {
    // 여덟 갈래가 같은 코드로 접히면 화면은 다시 한 문장밖에 말할 수 없다.
    const submissionCodes = reasons.map(
      (reason) => SUBMISSION_ZIP_REJECTION_ERROR_CODES[reason],
    );
    const documentCodes = reasons.map(
      (reason) => MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[reason],
    );
    expect(new Set(submissionCodes).size).toBe(reasons.length);
    expect(new Set(documentCodes).size).toBe(reasons.length);
  });
});
