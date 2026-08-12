import { Role } from '@prisma/client';
import { Readable } from 'node:stream';
import {
  MilestoneDocumentFileRetentionUnavailableError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
} from './milestone-document-files.service';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';

// 합성 데이터만 사용한다 (docs/rules/security.md)
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
    findActiveUser: jest
      .fn()
      .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
      submissionType: 'FILE',
    }),
    findStudentApplication: jest.fn().mockResolvedValue({
      applicationId: syntheticApplicationId,
      approved: true,
      programEndAt: new Date('2026-12-19T00:00:00.000Z'),
    }),
    createPendingFile: jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-pending-file',
      originalFileName: '계획서.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      expiresAt: new Date('2027-12-19T00:00:00.000Z'),
    }),
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
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, undefined),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD },
    });
  });

  it('milestoneId/documentId가 opaque id 형태가 아니면 INVALID_FILE_UPLOAD로 거부한다', async () => {
    // Given
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
    );

    // When / Then
    await expect(
      service.upload(1n, { evil: true }, syntheticDocumentId, pdfFile),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD },
    });
  });

  it('서명이 확장자와 다른 파일은 UNSUPPORTED_FILE_TYPE으로 거부한다', async () => {
    // Given: 확장자는 .pdf지만 매직 바이트가 PDF 서명이 아니다.
    const service = new MilestoneDocumentFilesService(
      buildRepository().repository,
      buildStorage().storage,
    );
    const forged: MilestoneDocumentFileUpload = {
      ...pdfFile,
      buffer: Buffer.from('not-a-real-pdf'),
    };

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, forged),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE },
    });
  });

  it('학생이 아니면 STUDENT_ONLY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
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
        dueAt: new Date(),
        required: true,
        submissionType: 'FILE',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
  });

  it('서류 항목의 제출 유형이 FILE이 아니면 CONTENT_TYPE_MISMATCH로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: new Date(),
        required: true,
        submissionType: 'TEXT',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH },
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
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
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
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      },
    });
  });

  it('잠근 프로그램 행이 없어 보관 기한 계산이 불가하면 FILE_RETENTION_UNAVAILABLE로 변환한다', async () => {
    // Given
    const { repository } = buildRepository({
      createPendingFile: jest
        .fn()
        .mockRejectedValue(
          new MilestoneDocumentFileRetentionUnavailableError(),
        ),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE,
      },
    });
  });

  it('통과하면 pending 파일을 만들고 스토리지에 올린 뒤 업로드 응답을 돌려준다', async () => {
    // Given
    const { mocks: repositoryMocks, repository } = buildRepository();
    const { mocks: storageMocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(repository, storage);

    // When
    const result = await service.upload(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      pdfFile,
    );

    // Then
    expect(repositoryMocks.createPendingFile).toHaveBeenCalledWith(
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
    );

    // When / Then
    await expect(
      service.upload(1n, syntheticMilestoneId, syntheticDocumentId, pdfFile),
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
    const service = new MilestoneDocumentFilesService(repository, storage);

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
    const service = new MilestoneDocumentFilesService(repository, storage);
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
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
      findStudentApplication: jest.fn(),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
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
    const service = new MilestoneDocumentFilesService(repository, storage);

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
        submissionType: 'FILE',
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage().storage,
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
    const service = new MilestoneDocumentFilesService(repository, storage);

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

  it('Content-Type은 DB mimeType이 아니라 허용 목록을 통과한 값을 쓴다', async () => {
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
    );

    // When
    const result = await service.downloadSubmissionFile(
      syntheticMilestoneId,
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('통과하면 스토리지에서 body를 읽어 다운로드 응답을 돌려준다', async () => {
    // Given
    const { repository } = buildRepository();
    const { mocks, storage } = buildStorage();
    const service = new MilestoneDocumentFilesService(repository, storage);

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
        submissionType: 'FILE',
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
    const service = new MilestoneDocumentFilesService(repository, storage);

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
