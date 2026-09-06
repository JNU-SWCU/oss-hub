import { Readable } from 'node:stream';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
} from './milestone-document-files.service';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
  type SubmissionFilesRepository,
} from '../submissions/submission-files.repository';
import { signatureValidZip } from '../submissions/submission-zip-test-builder';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../submissions/submission-upload-policy';

// 합성 데이터만 사용한다 (docs/rules/security.md)
/**
 * 이 스펙이 서는 고정 시각. 기본 마일스톤 `dueAt`(2026-09-19T09:00:00Z)보다 앞이라
 * 마감 전 상태를 뜻한다.
 *
 * ⚠ `service.upload`의 `now`는 기본값이 `new Date()`다. 넘기지 않으면 실제 시각으로
 * 마감을 판정하므로, 고정 `dueAt`을 지나면 코드를 아무도 건드리지 않았는데 업로드가
 * MILESTONE_CLOSED 로 막혀 테스트가 뒤집힌다 — 같은 일이 checklist 스펙에서 실제로
 * 일어났다(#1144). 마감 경계 자체를 보는 테스트만 자기 시각을 따로 넘긴다.
 */
const UPLOAD_NOW = new Date('2026-09-01T00:00:00.000Z');

const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticDocumentId = 'cuid-synthetic-document';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticUserId = 'cuid-synthetic-user';

const pdfFile: MilestoneDocumentFileUpload = {
  buffer: Buffer.concat([Buffer.from('%PDF-'), Buffer.from('synthetic body')]),
  originalname: '계획서.pdf',
  mimetype: 'application/pdf',
  size: 20,
};

function buildRepository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const mocks = {
    findActiveUser: jest.fn().mockResolvedValue({
      id: syntheticUserId,
      hasStaffAccess: false,
      hasAdminAccess: false,
    }),
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
    }),
    findStudentApplication: jest.fn().mockResolvedValue({
      applicationId: syntheticApplicationId,
      approved: true,
      programEndAt: new Date('2026-12-19T00:00:00.000Z'),
    }),
    findMySubmission: jest.fn().mockResolvedValue(null),
    findLatestReview: jest.fn().mockResolvedValue(null),
    upsertTemplateFile: jest.fn().mockResolvedValue(undefined),
    findTemplateForDownload: jest.fn().mockResolvedValue({
      storageKey: 'objects/synthetic-template',
      originalFileName: '계획서_양식.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    }),
    findApplicationProgramId: jest.fn().mockResolvedValue(syntheticProgramId),
    findSubmissionFileForStaffDownload: jest.fn().mockResolvedValue({
      storageKey: 'objects/synthetic-submission',
      originalFileName: '최종_진짜최종.hwp',
      mimeType: 'application/x-hwp',
      sizeBytes: 2048,
      teamName: '가나다팀',
    }),
    ...overrides,
  };
  return {
    mocks,
    repository: mocks as unknown as MilestoneDocumentsRepository,
  };
}

/**
 * 학생 업로드의 pending 행 생성은 submissions/의 SubmissionFilesRepository.createPending에
 * 위임한다 — 할당량(개수·총 바이트) 판정이 그 트랜잭션 안에 있기 때문이다.
 */
function buildSubmissionFiles(
  overrides: Partial<Record<string, jest.Mock>> = {},
) {
  const mocks = {
    createPending: jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-pending-file',
      originalFileName: '계획서.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      expiresAt: new Date('2027-12-19T00:00:00.000Z'),
    }),
    ...overrides,
  };
  return {
    mocks,
    submissionFiles: mocks as unknown as SubmissionFilesRepository,
  };
}

function buildStorage(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const mocks = {
    put: jest.fn().mockResolvedValue({
      objectKey: 'objects/synthetic',
      originalName: '계획서.pdf',
      contentLength: 20,
      contentType: 'application/pdf',
    }),
    get: jest.fn().mockResolvedValue(Readable.from(Buffer.from('body'))),
    delete: jest.fn(),
    ...overrides,
  };
  return { mocks, storage: mocks as unknown as SubmissionFileStoragePort };
}

describe('MilestoneDocumentFilesService.upload (학생)', () => {
  it('유효하지 않은 파일이면 INVALID_FILE_UPLOAD로 거부한다', async () => {
    // Given
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        undefined,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD },
    });
  });

  /*
   * #1107 — 5 MiB를 넘고 nginx 천장(6 MB) 이하인 파일은 여기까지 온다. 그때 학생이 읽는
   * 문구가 「파일 크기가 너무 큽니다.」였는데, 상한 숫자가 없어 얼마나 줄여야 하는지 알 수
   * 없었다. 화면이 파일을 고르기 전에 보여 주는 문장과 같은 문장이어야 한다.
   */
  it('상한을 넘으면 FILE_TOO_LARGE로 거부하고 문구에 상한을 적는다', async () => {
    // Given: 선언 크기만 상한을 넘는다(실제 버퍼를 5 MiB로 만들지 않는다).
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );
    const tooLarge: MilestoneDocumentFileUpload = {
      ...pdfFile,
      size: SUBMISSION_UPLOAD_MAX_BYTES + 1,
    };

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        tooLarge,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.FILE_TOO_LARGE },
    });
    expect(
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.FILE_TOO_LARGE
      ].message,
    ).toBe(
      `파일은 ${SUBMISSION_UPLOAD_MAX_BYTES / 1024 / 1024} MB 이하여야 합니다.`,
    );
  });

  it('milestoneId/documentId가 opaque id 형태가 아니면 INVALID_FILE_UPLOAD로 거부한다', async () => {
    // Given
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        { evil: true },
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD },
    });
  });

  it('서명이 확장자와 다른 파일은 UNSUPPORTED_FILE_TYPE으로 거부한다', async () => {
    // Given: 확장자는 .pdf지만 매직 바이트가 PDF 서명이 아니다.
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );
    const forged: MilestoneDocumentFileUpload = {
      ...pdfFile,
      buffer: Buffer.from('not-a-real-pdf'),
    };

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        forged,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE },
    });
  });

  it('학생이 아니면 STUDENT_ONLY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: 'staff-1',
        hasStaffAccess: true,
        hasAdminAccess: false,
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.STUDENT_ONLY },
    });
  });

  it('서류 항목이 이 마일스톤 소속이 아니면 DOCUMENT_NOT_FOUND로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-other-milestone',
        programId: syntheticProgramId,
        dueAt: new Date('2030-01-01T00:00:00.000Z'),
        required: true,
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
  });

  it('기존 본문 제출이 있어도 파일을 추가로 올릴 수 있다', async () => {
    // Given: 제출 방식은 항목 설정이 아니라 저장된 본문·파일 증거로 결정된다.
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: new Date('2030-01-01T00:00:00.000Z'),
        required: true,
      }),
      findMySubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-text-submission',
        content: { type: 'TEXT', text: '기존 본문' },
        file: null,
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then: 기존 본문이 있어도 첨부 파일을 추가할 수 있다.
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).resolves.toMatchObject({
      fileId: 'cuid-synthetic-pending-file',
      fileName: '계획서.pdf',
    });
  });

  it('이 프로그램 신청이 없으면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('승인 전 신청이면 APPLICATION_APPROVAL_REQUIRED로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: new Date('2026-12-19T00:00:00.000Z'),
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      },
    });
  });

  it('마감 후에는 첫 파일 업로드를 만들지 않는다', async () => {
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        name: '계획서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
      }),
    });
    const { mocks, submissionFiles } = buildSubmissionFiles();
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      submissionFiles,
    );

    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        new Date('2026-09-19T09:00:00.001Z'),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_CLOSED },
    });
    expect(mocks.createPending).not.toHaveBeenCalled();
  });

  /**
   * 보완 요청을 받고 **아직 응하지 않은** 서류. 제출 관문이 이 자리를 열어 두므로 업로드도
   * 열려 있어야 한다 — 아니면 「다시 내세요」라는 요청에 파일을 붙일 수 없다.
   */
  it('아직 응하지 않은 보완 요청이면 마감 후에도 파일을 올릴 수 있다', async () => {
    const { repository } = buildRepository({
      findMySubmission: jest.fn().mockResolvedValue({
        id: 'submission-1',
        status: 'CHANGES_REQUESTED',
      }),
      findLatestReview: jest.fn().mockResolvedValue({
        id: 'review-1',
        decision: 'CHANGES_REQUESTED',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ fileId: 'cuid-synthetic-pending-file' });
  });

  /**
   * #1097 — 그 한 번을 이미 썼으면 업로드도 함께 닫힌다. 두 관문이 갈라지면 학생은 파일을
   * 올리는 데까지 성공한 뒤 제출에서 막혀, 무엇이 잘못됐는지 알 수 없는 자리에 선다.
   */
  it('보완 요청에 응해 이미 다시 냈으면 마감 후 파일 업로드도 막는다', async () => {
    const { repository } = buildRepository({
      findMySubmission: jest.fn().mockResolvedValue({
        id: 'submission-1',
        // 재제출이 상태를 되돌려 놓았다 — 판정은 아직 보완 요청 그대로다.
        status: 'SUBMITTED',
      }),
      findLatestReview: jest.fn().mockResolvedValue({
        id: 'review-1',
        decision: 'CHANGES_REQUESTED',
      }),
    });
    const { mocks, submissionFiles } = buildSubmissionFiles();
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      submissionFiles,
    );

    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
      },
    });
    expect(mocks.createPending).not.toHaveBeenCalled();
  });

  it('잠근 프로그램 행이 없어 보관 기한 계산이 불가하면 FILE_RETENTION_UNAVAILABLE로 변환한다', async () => {
    // Given
    const { submissionFiles } = buildSubmissionFiles({
      createPending: jest
        .fn()
        .mockRejectedValue(new SubmissionFileRetentionUnavailableError()),
    });
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
      submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE,
      },
    });
  });

  /**
   * 제출물 경로(submissions/)와 같은 보관 할당량을 학생 서류 업로드에도 강제한다 —
   * 둘은 같은 SubmissionFile 테이블에 쓰므로 여기가 비어 있으면 한도를 우회할 수 있다.
   */
  it('보관 한도를 넘기면 SUBMISSION_FILE_QUOTA_EXCEEDED로 변환하고 스토리지에 올리지 않는다', async () => {
    // Given
    const { submissionFiles } = buildSubmissionFiles({
      createPending: jest
        .fn()
        .mockRejectedValue(new SubmissionFileQuotaExceededError()),
    });
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      storage,
      submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
      },
    });
    expect(storageMocks.put).not.toHaveBeenCalled();
  });

  /**
   * ZIP 입장 검사도 제출물 경로와 같은 계약이어야 한다 — 서명(PK\x03\x04)만 맞는
   * 압축 폭탄·중첩 아카이브를 학생 서류 경로로 넣을 수 있으면 검사 자체가 무의미해진다.
   */
  it('메타데이터 검사를 통과하지 못하는 .zip은 UNSUPPORTED_FILE_TYPE으로 거부한다', async () => {
    // Given: 서명은 진짜 집이지만 안에 또 다른 집이 들어 있다(중첩 아카이브).
    const nestedArchive = signatureValidZip([{ name: 'nested.zip' }]);
    const { mocks: submissionFileMocks, submissionFiles } =
      buildSubmissionFiles();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      storage,
      submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, {
        buffer: nestedArchive,
        originalname: '제출묶음.zip',
        mimetype: 'application/zip',
        size: nestedArchive.byteLength,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE },
    });
    expect(submissionFileMocks.createPending).not.toHaveBeenCalled();
    expect(storageMocks.put).not.toHaveBeenCalled();
  });

  it('메타데이터 검사를 통과한 .zip은 그대로 받아들인다', async () => {
    // Given
    const archive = signatureValidZip([{ name: 'valid.txt' }]);
    const { mocks: submissionFileMocks, submissionFiles } =
      buildSubmissionFiles();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      storage,
      submissionFiles,
    );

    // When
    await service.upload(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      {
        buffer: archive,
        originalname: '제출묶음.zip',
        mimetype: 'application/zip',
        size: archive.byteLength,
      },
      UPLOAD_NOW,
    );

    // Then
    expect(submissionFileMocks.createPending).toHaveBeenCalledTimes(1);
    expect(storageMocks.put).toHaveBeenCalledTimes(1);
  });

  it('통과하면 pending 파일을 만들고 스토리지에 올린 뒤 업로드 응답을 돌려준다', async () => {
    // Given
    const { repository } = buildRepository();
    const { mocks: submissionFileMocks, submissionFiles } =
      buildSubmissionFiles();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      submissionFiles,
    );

    // When
    const result = await service.upload(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      pdfFile,
      UPLOAD_NOW,
    );

    // Then
    expect(submissionFileMocks.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        uploaderId: syntheticUserId,
        applicationId: syntheticApplicationId,
        milestoneId: syntheticMilestoneId,
        originalFileName: '계획서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfFile.buffer.byteLength,
      }),
    );
    expect(storageMocks.put).toHaveBeenCalledTimes(1);
    expect(result.fileId).toBe('cuid-synthetic-pending-file');
  });

  it('스토리지 업로드가 실패하면 FILE_STORAGE_UNAVAILABLE로 변환한다', async () => {
    // Given
    const { storage } = buildStorage({
      put: jest.fn().mockRejectedValue(new Error('s3 down')),
    });
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.upload(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
        UPLOAD_NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE },
    });
  });
});

describe('MilestoneDocumentFilesService.uploadTemplate (교직원, "양식 올리기"/"양식 교체")', () => {
  it('서류 항목이 이 마일스톤 소속이 아니면 DOCUMENT_NOT_FOUND로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.uploadTemplate(
        'staff-1',
        syntheticMilestoneId,
        syntheticDocumentId,
        pdfFile,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
  });

  it('통과하면 스토리지에 올리고 템플릿 파일을 upsert한다', async () => {
    // Given
    const { mocks: repositoryMocks, repository } = buildRepository();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.uploadTemplate(
      'staff-1',
      syntheticMilestoneId,
      syntheticDocumentId,
      pdfFile,
    );

    // Then
    expect(storageMocks.put).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.upsertTemplateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        milestoneDocumentId: syntheticDocumentId,
        uploadedById: 'staff-1',
        originalFileName: '계획서.pdf',
      }),
    );
    expect(result.hasTemplateFile).toBe(true);
  });

  it('multipart latin1 깨짐을 복구한 한글 양식 파일명을 저장한다', async () => {
    const { mocks: repositoryMocks, repository } = buildRepository();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );
    const mojibake = Buffer.from('제출-양식.pdf', 'utf8').toString('latin1');

    const result = await service.uploadTemplate(
      'staff-1',
      syntheticMilestoneId,
      syntheticDocumentId,
      { ...pdfFile, originalname: mojibake },
    );

    expect(repositoryMocks.upsertTemplateFile).toHaveBeenCalledWith(
      expect.objectContaining({ originalFileName: '제출-양식.pdf' }),
    );
    expect(storageMocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: '제출-양식.pdf' }),
    );
    expect(result.fileName).toBe('제출-양식.pdf');
  });
});

describe('MilestoneDocumentFilesService.downloadTemplate ("양식" 다운로드)', () => {
  it('세션 계정을 찾지 못하면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadTemplate(1n, syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('교직원은 이 프로그램 신청 여부와 무관하게 다운로드할 수 있다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: 'staff-1',
        hasStaffAccess: true,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn(),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    await service.downloadTemplate(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
    );

    // Then
    expect(mocks.findStudentApplication).not.toHaveBeenCalled();
  });

  it('학생인데 이 프로그램 신청이 없으면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadTemplate(1n, syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('등록된 양식이 없으면 TEMPLATE_NOT_FOUND로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findTemplateForDownload: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadTemplate(1n, syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.TEMPLATE_NOT_FOUND },
    });
  });

  it('통과하면 스토리지에서 body를 읽어 다운로드 응답을 돌려준다', async () => {
    // Given
    const { repository } = buildRepository();
    const { mocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.downloadTemplate(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
    );

    // Then
    expect(mocks.get).toHaveBeenCalledWith('objects/synthetic-template');
    expect(result.fileName).toBe('계획서_양식.pdf');
    expect(result.contentLength).toBe(2048);
  });
});

describe('MilestoneDocumentFilesService.downloadSubmissionFile (교직원)', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('서류 항목이 이 마일스톤 소속이 아니면 DOCUMENT_NOT_FOUND로 거부한다', async () => {
    // Given: 인가 사슬 2번.
    const { mocks, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        programId: syntheticProgramId,
        name: '개인정보 수집·이용 동의서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.findSubmissionFileForStaffDownload).not.toHaveBeenCalled();
  });

  it('서류 항목이 없으면 DOCUMENT_NOT_FOUND로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
  });

  it('신청이 이 마일스톤의 프로그램 소속이 아니면 SUBMISSION_FILE_NOT_FOUND로 거부한다', async () => {
    // Given: 인가 사슬 3번 — 가드가 역할만 보므로 경로를 위조한 교직원이
    // 다른 프로그램의 파일을 끌어오려는 상황이다.
    const { mocks, repository } = buildRepository({
      findApplicationProgramId: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-other-program'),
    });
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
      },
    });
    expect(mocks.findSubmissionFileForStaffDownload).not.toHaveBeenCalled();
    expect(storageMocks.get).not.toHaveBeenCalled();
  });

  it('신청 자체가 없으면 SUBMISSION_FILE_NOT_FOUND로 거부한다', async () => {
    // Given: 인가 사슬 3번 — programId가 null이면 어떤 프로그램과도 일치하지 않는다.
    const { mocks, repository } = buildRepository({
      findApplicationProgramId: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
      },
    });
    expect(mocks.findSubmissionFileForStaffDownload).not.toHaveBeenCalled();
  });

  it('살아 있는 첨부가 없으면(미제출·만료·삭제 예정) SUBMISSION_FILE_NOT_FOUND로 거부한다', async () => {
    // Given: 인가 사슬 4번.
    const { repository } = buildRepository({
      findSubmissionFileForStaffDownload: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
      },
    });
  });

  it('첨부 조회에 현재 시각을 넘겨 만료된 파일이 걸러지게 한다', async () => {
    // Given
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(mocks.findSubmissionFileForStaffDownload).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );
  });

  it('내려받는 이름을 `팀명_서류명.확장자`로 다시 붙인다', async () => {
    // Given: 학생은 구분되지 않는 이름(`최종_진짜최종.hwp`)으로 올렸다.
    const { repository } = buildRepository();
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then: 원본 이름이 그대로 새어 나오면 안 된다.
    expect(result.fileName).toBe('가나다팀_개인정보 수집·이용 동의서.hwp');
    expect(result.fileName).not.toBe('최종_진짜최종.hwp');
  });

  it('Content-Type은 DB mimeType이 아니라 확장자의 정규 값을 쓴다', async () => {
    // Given: DB에 저장된 mimeType이 확장자와 맞지 않는다.
    const { repository } = buildRepository({
      findSubmissionFileForStaffDownload: jest.fn().mockResolvedValue({
        storageKey: 'objects/synthetic-submission',
        originalFileName: '보고서.pdf',
        mimeType: 'text/html',
        sizeBytes: 512,
        teamName: '가나다팀',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(result.contentType).toBe('application/pdf');
  });

  it('통과하면 스토리지에서 body를 읽어 다운로드 응답을 돌려준다', async () => {
    // Given
    const { repository } = buildRepository();
    const { mocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(mocks.get).toHaveBeenCalledWith('objects/synthetic-submission');
    expect(result.contentType).toBe('application/x-hwp');
    expect(result.contentLength).toBe(2048);
    expect(result.fileName).toBe('가나다팀_개인정보 수집·이용 동의서.hwp');
  });

  it('이름은 서류 항목의 이름과 제출 팀의 이름으로 만든다(순서가 뒤바뀌지 않는다)', async () => {
    // Given: 팀명과 서류명이 서로 확실히 다르다.
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        name: '팀 구성 확인서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
      }),
      findSubmissionFileForStaffDownload: jest.fn().mockResolvedValue({
        storageKey: 'objects/synthetic-submission',
        originalFileName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        teamName: '라마바팀',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When
    const result = await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(result.fileName).toBe('라마바팀_팀 구성 확인서.pdf');
  });

  it('스토리지 읽기가 실패하면 FILE_STORAGE_UNAVAILABLE로 감싼다', async () => {
    // Given
    const { repository } = buildRepository();
    const { storage } = buildStorage({
      get: jest.fn().mockRejectedValue(new Error('synthetic storage down')),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      storage,
      buildSubmissionFiles().submissionFiles,
    );

    // When / Then
    await expect(
      service.downloadSubmissionFile(
        syntheticMilestoneId,
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE },
    });
  });
});
