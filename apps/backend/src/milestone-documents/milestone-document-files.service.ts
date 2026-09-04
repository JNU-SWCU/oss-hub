import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../common/error-code';
import { normalizeMultipartFileName } from '../common/multipart-file-name';
import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from '../submissions/submission-file-content-type';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from '../submissions/submission-file-name';
import { hasValidSubmissionFileSignature } from '../submissions/submission-file-signature';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
  SubmissionFilesRepository,
} from '../submissions/submission-files.repository';
import { inspectSubmissionZipMetadata } from '../submissions/submission-zip-admission';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../submissions/submission-upload-policy';
import { milestoneDocumentSubmissionBlock } from './domain/milestone-document-submission-window';
import { milestoneDocumentDownloadFileName } from './milestone-document-download-file-name';
import {
  MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

const MAX_FILE_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
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

/** 교직원 다운로드 — fileName은 학생이 올린 원본이 아니라 `팀명_서류명.확장자`로 다시 붙인 이름이다. */
export interface DownloadedMilestoneDocumentSubmissionFile {
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
    private readonly submissionFiles: SubmissionFilesRepository,
  ) {}

  /** 학생 — 제출에 선택적으로 붙일 파일을 pending 상태로 올린다. */
  async upload(
    sessionGithubId: bigint,
    milestoneId: unknown,
    documentId: unknown,
    file: MilestoneDocumentFileUpload | undefined,
    now: Date = new Date(),
  ): Promise<UploadedMilestoneDocumentFileResponse> {
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    const normalizedDocumentId = this.requiredOpaqueId(documentId);
    const originalName = await this.validateOriginalFileName(file);
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null || viewer.hasStaffAccess || viewer.hasAdminAccess) {
      throw this.error(MilestoneDocumentsErrorCode.STUDENT_ONLY);
    }

    const documentContext =
      await this.repository.findDocumentContext(normalizedDocumentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== normalizedMilestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const application = await this.repository.findStudentApplication(
      viewer.id,
      documentContext.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!application.approved) {
      throw this.error(
        MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      );
    }

    const [currentSubmission, latestReview] = await Promise.all([
      this.repository.findMySubmission(
        normalizedDocumentId,
        application.applicationId,
      ),
      this.repository.findLatestReview(
        normalizedDocumentId,
        application.applicationId,
      ),
    ]);
    const blocked = milestoneDocumentSubmissionBlock({
      dueAt: documentContext.dueAt,
      now,
      hasSubmission: currentSubmission !== null,
      latestDecision: latestReview?.decision ?? null,
    });
    if (blocked !== null) {
      throw this.error(MilestoneDocumentsErrorCode[blocked]);
    }

    const objectKey = createSubmissionFileObjectKey();

    let created;
    try {
      created = await this.submissionFiles.createPending({
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
      if (error instanceof SubmissionFileQuotaExceededError) {
        throw this.error(
          MilestoneDocumentsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
        );
      }
      if (error instanceof SubmissionFileRetentionUnavailableError) {
        throw this.error(
          MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE,
        );
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
    const originalName = await this.validateOriginalFileName(file);
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const objectKey = createSubmissionFileObjectKey();
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

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    if (!viewer.hasStaffAccess && !viewer.hasAdminAccess) {
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
      contentType: safeSubmissionFileContentType(template.originalFileName),
      contentLength: template.sizeBytes,
    };
  }

  /**
   * 교직원 — 한 팀이 낸 서류 제출 파일을 내려받는다
   * (`GET /milestones/:milestoneId/documents/:documentId/applications/:applicationId/file`).
   *
   * 일반 `GET /submission-files/:fileId`와 달리, 이 endpoint는 교직원 수합 화면의
   * (마일스톤, 서류 항목, 신청) 경로 자체를 검증하고 그 경로의 현재 첨부를 찾는다.
   *
   * 인가는 순서대로 전부 검사한다.
   * 1. ACTIVE + STAFF/ADMIN — MilestoneDocumentsStaffGuard가 endpoint 앞단에서 본다.
   * 2. 서류 항목이 이 마일스톤 소속인가.
   * 3. 신청이 이 마일스톤의 프로그램 소속인가 — 가드가 역할만 보므로(프로그램 단위 소유권 컬럼이
   *    스키마에 없다) 경로를 위조해 다른 프로그램 데이터를 끌어오는 것을 여기서 막는다.
   * 4. 그 (서류, 신청) 제출에 ATTACHED이고 아직 만료되지 않은 첨부가 있는가.
   */
  async downloadSubmissionFile(
    milestoneId: string,
    documentId: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<DownloadedMilestoneDocumentSubmissionFile> {
    // 2. 서류 항목이 이 마일스톤 소속인가.
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    // 3. 신청이 이 마일스톤의 프로그램 소속인가.
    const applicationProgramId =
      await this.repository.findApplicationProgramId(applicationId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    // 4. ATTACHED이고 만료되지 않은 첨부가 있는가.
    const file = await this.repository.findSubmissionFileForStaffDownload(
      documentId,
      applicationId,
      now,
    );
    if (file === null) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      body,
      fileName: milestoneDocumentDownloadFileName({
        teamName: file.teamName,
        documentName: documentContext.name,
        originalFileName: file.originalFileName,
      }),
      contentType: safeSubmissionFileContentType(file.originalFileName),
      contentLength: file.sizeBytes,
    };
  }

  /**
   * 검사 순서를 submissions/submission-files.service.ts와 같게 둔다 — 확장자 → 서명 →
   * (.zip이면) 아카이브 메타데이터 입장 검사. 둘은 같은 저장 스택으로 들어가므로
   * 한쪽만 느슨하면 그쪽이 계약을 우회하는 입구가 된다.
   */
  private async validateOriginalFileName(
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<string> {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.FILE_TOO_LARGE);
    }
    const normalizedFileName = normalizeMultipartFileName(file.originalname);
    if (
      !isAllowedSubmissionFileType(normalizedFileName) ||
      !hasValidSubmissionFileSignature(file.buffer, normalizedFileName)
    ) {
      throw this.error(MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE);
    }
    /*
     * 거절 사유를 갈래별 코드로 옮기는 것도 제출 경로와 같은 계약이다(#1108). 한쪽만
     * 고치면 같은 압축 파일이 제출 화면에서는 고칠 방법을 듣고 서류 화면에서는 「지원하지
     * 않는 파일 형식입니다」를 듣는다.
     */
    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection = await inspectSubmissionZipMetadata(file.buffer);
      if (zipRejection !== null) {
        throw this.error(
          MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[zipRejection],
        );
      }
    }
    return sanitizeSubmissionFileOriginalName(normalizedFileName);
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
