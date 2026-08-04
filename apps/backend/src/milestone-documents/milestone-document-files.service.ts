import { Inject, Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, Role } from '@prisma/client';
import type { Readable } from 'node:stream';
import { DomainException } from '../common/error-code';
import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from '../submissions/submission-file-content-type';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from '../submissions/submission-file-name';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentFileRetentionUnavailableError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface MilestoneDocumentFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface UploadedMilestoneDocumentFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface UploadedMilestoneDocumentTemplateResponse {
  readonly documentId: string;
  readonly hasTemplateFile: true;
  readonly fileName: string;
  readonly uploadedAt: string;
}

export interface DownloadedMilestoneDocumentTemplate {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

/**
 * 마일스톤 서류 항목의 파일 업로드/양식 파일 업로드·다운로드를 담당한다. 저장 스택은
 * submissions/의 SubmissionFile·S3(MinIO) 경로를 그대로 재사용한다(새 업로드 스택을 만들지 않는다) —
 * submission-file-name.ts/submission-file-content-type.ts/submission-file-storage.port.ts는
 * 읽기 전용으로 import만 하고 수정하지 않는다.
 */
@Injectable()
export class MilestoneDocumentFilesService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
  ) {}

  /** 학생 — 서류(FILE 유형) 제출용 파일을 pending 상태로 올린다. 실제 제출은 이후 submit()이 attach한다. */
  async upload(
    sessionGithubId: bigint,
    milestoneId: unknown,
    documentId: unknown,
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentFileResponse> {
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    const normalizedDocumentId = this.requiredOpaqueId(documentId);
    this.assertValidFile(file);
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null || viewer.role !== Role.STUDENT) {
      throw this.error(MilestoneDocumentsErrorCode.STUDENT_ONLY);
    }

    const documentContext = await this.repository.findDocumentContext(
      normalizedDocumentId,
    );
    if (
      documentContext === null ||
      documentContext.milestoneId !== normalizedMilestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    if (documentContext.submissionType !== MilestoneSubmissionType.FILE) {
      throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
    }

    const application = await this.repository.findStudentApplication(
      viewer.id,
      documentContext.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!application.approved) {
      throw this.error(MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED);
    }

    const now = new Date();
    const objectKey = createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(
      uploadedFile.originalname,
    );

    let created;
    try {
      created = await this.repository.createPendingFile({
        uploaderId: viewer.id,
        applicationId: application.applicationId,
        milestoneId: normalizedMilestoneId,
        storageKey: objectKey,
        originalFileName: originalName,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.buffer.byteLength,
        pendingExpiresAt: new Date(now.getTime() + PENDING_TTL_MS),
      });
    } catch (error) {
      if (error instanceof MilestoneDocumentFileRetentionUnavailableError) {
        throw this.error(MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE);
      }
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    try {
      await this.storage.put({
        body: uploadedFile.buffer,
        contentType: uploadedFile.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      fileId: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt!.toISOString(),
    };
  }

  /** 교직원 — 서류 항목의 양식 파일을 올리거나 교체한다("양식 올리기"/"양식 교체"). */
  async uploadTemplate(
    actorId: string,
    milestoneId: string,
    documentId: string,
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    this.assertValidFile(file);
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const documentContext = await this.repository.findDocumentContext(
      documentId,
    );
    if (documentContext === null || documentContext.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const objectKey = createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(
      uploadedFile.originalname,
    );
    const now = new Date();

    try {
      await this.storage.put({
        body: uploadedFile.buffer,
        contentType: uploadedFile.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    await this.repository.upsertTemplateFile({
      milestoneDocumentId: documentId,
      uploadedById: actorId,
      storageKey: objectKey,
      originalFileName: originalName,
      mimeType: uploadedFile.mimetype,
      sizeBytes: uploadedFile.buffer.byteLength,
      uploadedAt: now,
    });

    return {
      documentId,
      hasTemplateFile: true,
      fileName: originalName,
      uploadedAt: now.toISOString(),
    };
  }

  /** 양식 다운로드("양식" 링크) — 교직원은 항상, 학생은 해당 프로그램 신청 참여자만 허용한다. */
  async downloadTemplate(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<DownloadedMilestoneDocumentTemplate> {
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }

    const documentContext = await this.repository.findDocumentContext(
      documentId,
    );
    if (documentContext === null || documentContext.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    if (viewer.role !== Role.STAFF && viewer.role !== Role.ADMIN) {
      const application = await this.repository.findStudentApplication(
        viewer.id,
        documentContext.programId,
      );
      if (application === null) {
        throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
      }
    }

    const template = await this.repository.findTemplateForDownload(documentId);
    if (template === null) {
      throw this.error(MilestoneDocumentsErrorCode.TEMPLATE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(template.storageKey);
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      body,
      fileName: template.originalFileName,
      contentType: safeSubmissionFileContentType(
        template.originalFileName,
        template.mimeType,
      ),
      contentLength: template.sizeBytes,
    };
  }

  private assertValidFile(file: MilestoneDocumentFileUpload | undefined): void {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.FILE_TOO_LARGE);
    }
    if (
      !isAllowedSubmissionFileType(file.originalname, file.mimetype) ||
      !hasValidFileSignature(file.buffer, file.originalname)
    ) {
      throw this.error(MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE);
    }
  }

  private requiredOpaqueId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim()
    ) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    return value;
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

/**
 * submissions/submission-files.service.ts의 동명 헬퍼와 같은 시그니처 테이블을 쓴다. 그 파일은
 * 이 함수를 export하지 않고 우리 owned path 밖이라 수정할 수 없어 그대로 복제해 둔다.
 */
function hasValidFileSignature(buffer: Buffer, fileName: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const signatures: Readonly<Record<string, readonly Buffer[]>> = {
    '.pdf': [Buffer.from('%PDF-')],
    '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    '.jpg': [Buffer.from([0xff, 0xd8, 0xff])],
    '.jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
    '.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    '.zip': [
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.from([0x50, 0x4b, 0x07, 0x08]),
    ],
  };
  return (
    signatures[extension]?.some(
      (signature) =>
        buffer.length >= signature.length &&
        buffer.subarray(0, signature.length).equals(signature),
    ) ?? false
  );
}
