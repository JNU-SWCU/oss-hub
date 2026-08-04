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
  return {
    findActiveUser: jest
      .fn()
      .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
      submissionType: 'FILE',
    }),
    findStudentApplication: jest.fn().mockResolvedValue({
      applicationId: syntheticApplicationId,
      approved: true,
      programEndAt: new Date('2026-12-19T00:00:00.000Z'),
      repositoryUrl: null,
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
    ...overrides,
  } as unknown as MilestoneDocumentsRepository;
}

function buildStorage(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    put: jest.fn().mockResolvedValue({
      objectKey: 'objects/synthetic',
      originalName: '계획서.pdf',
      contentLength: 20,
      contentType: 'application/pdf',
    }),
    get: jest.fn().mockResolvedValue(Readable.from(Buffer.from('body'))),
    delete: jest.fn(),
    ...overrides,
  } as unknown as SubmissionFileStoragePort;
}

describe('MilestoneDocumentFilesService.upload (학생)', () => {
  it('유효하지 않은 파일이면 INVALID_FILE_UPLOAD로 거부한다', async () => {
    // Given
    const service = new MilestoneDocumentFilesService(
      buildRepository(),
      buildStorage(),
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
      buildRepository(),
      buildStorage(),
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
      buildRepository(),
      buildStorage(),
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
    const repository = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository({
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
      buildStorage(),
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
    const repository = buildRepository({
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
      buildStorage(),
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
    const repository = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: null,
        repositoryUrl: null,
      }),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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

  it('프로그램 종료일 미설정으로 보관 기한 계산이 불가하면 FILE_RETENTION_UNAVAILABLE로 변환한다', async () => {
    // Given
    const repository = buildRepository({
      createPendingFile: jest
        .fn()
        .mockRejectedValue(
          new MilestoneDocumentFileRetentionUnavailableError(),
        ),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository();
    const storage = buildStorage();
    const service = new MilestoneDocumentFilesService(repository, storage);

    // When
    const result = await service.upload(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      pdfFile,
    );

    // Then
    expect(repository.createPendingFile).toHaveBeenCalledWith(
      expect.objectContaining({
        uploaderId: syntheticUserId,
        applicationId: syntheticApplicationId,
        milestoneId: syntheticMilestoneId,
        originalFileName: '계획서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfFile.buffer.byteLength,
      }),
    );
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(result.fileId).toBe('cuid-synthetic-pending-file');
  });

  it('스토리지 업로드가 실패하면 FILE_STORAGE_UNAVAILABLE로 변환한다', async () => {
    // Given
    const storage = buildStorage({
      put: jest.fn().mockRejectedValue(new Error('s3 down')),
    });
    const service = new MilestoneDocumentFilesService(
      buildRepository(),
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
    const repository = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository();
    const storage = buildStorage();
    const service = new MilestoneDocumentFilesService(repository, storage);

    // When
    const result = await service.uploadTemplate(
      'staff-1',
      syntheticMilestoneId,
      syntheticDocumentId,
      pdfFile,
    );

    // Then
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(repository.upsertTemplateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        milestoneDocumentId: syntheticDocumentId,
        uploadedById: 'staff-1',
        originalFileName: '계획서.pdf',
      }),
    );
    expect(result.hasTemplateFile).toBe(true);
  });
});

describe('MilestoneDocumentFilesService.downloadTemplate ("양식" 다운로드)', () => {
  it('세션 계정을 찾지 못하면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const repository = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
      findStudentApplication: jest.fn(),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
    );

    // When
    await service.downloadTemplate(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
    );

    // Then
    expect(repository.findStudentApplication).not.toHaveBeenCalled();
  });

  it('학생인데 이 프로그램 신청이 없으면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const repository = buildRepository({
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository({
      findTemplateForDownload: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentFilesService(
      repository,
      buildStorage(),
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
    const repository = buildRepository();
    const storage = buildStorage();
    const service = new MilestoneDocumentFilesService(repository, storage);

    // When
    const result = await service.downloadTemplate(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
    );

    // Then
    expect(storage.get).toHaveBeenCalledWith('objects/synthetic-template');
    expect(result.fileName).toBe('계획서_양식.pdf');
    expect(result.contentLength).toBe(2048);
  });
});
