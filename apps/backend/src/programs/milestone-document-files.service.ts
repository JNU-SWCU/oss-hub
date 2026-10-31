import type { Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import type { ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './submission-file.error';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

export interface UploadedMilestoneDocumentFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

const MAX_FILE_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface MilestoneDocumentFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
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

export interface DownloadedMilestoneDocumentSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

@Injectable()
export class MilestoneDocumentFilesService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    private readonly submissionFiles: SubmissionFilesService,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
    private readonly submissionFileRulesService: SubmissionFileRulesService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  async downloadTemplateTo(
    response: Response,
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<StreamableFile> {
    const file = await this.downloadTemplate(
      sessionGithubId,
      milestoneId,
      documentId,
    );
    return this.downloadResponseService.streamableFile(response, file);
  }

  async downloadSubmissionFileTo(
    response: Response,
    milestoneId: string,
    documentId: string,
    applicationId: string,
  ): Promise<StreamableFile> {
    const file = await this.downloadSubmissionFile(
      milestoneId,
      documentId,
      applicationId,
    );
    return this.downloadResponseService.streamableFile(response, file);
  }

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

    const viewer =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (viewer === null) {
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

    const blocked =
      this.milestoneDocumentRulesService.milestoneDocumentSubmissionBlock({
        dueAt: documentContext.dueAt,
        graceDueAt: documentContext.graceDueAt,
        now,
        hasSubmission: currentSubmission !== null,
        latestDecision: latestReview?.decision ?? null,
        submissionStatus: currentSubmission?.status ?? null,
        resubmissionDueAt: latestReview?.resubmissionDueAt ?? null,
      });
    if (blocked !== null) {
      throw this.error(MilestoneDocumentsErrorCode[blocked]);
    }

    const objectKey =
      this.submissionFileRulesService.createSubmissionFileObjectKey();

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
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
      }
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

  async check(file: MilestoneDocumentFileUpload | undefined): Promise<void> {
    await this.validateOriginalFileName(file);
  }

  async uploadTemplate(
    actorId: string,
    milestoneId: string,
    documentId: string,
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    const originalName = await this.validateOriginalFileName(file, 'TEMPLATE');
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const objectKey =
      this.submissionFileRulesService.createSubmissionFileObjectKey();
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

    await this.repository.withTransaction(async (store) => {
      const lockedDocument = await store.lockDocument(documentId);
      if (
        lockedDocument === null ||
        lockedDocument.milestoneId !== milestoneId
      ) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }

      await store.upsertTemplateFile({
        milestoneDocumentId: documentId,
        uploadedById: actorId,
        storageKey: objectKey,
        originalFileName: originalName,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.buffer.byteLength,
        uploadedAt: now,
      });
    });

    return {
      documentId,
      hasTemplateFile: true,
      fileName: originalName,
      uploadedAt: now.toISOString(),
    };
  }

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
      contentType:
        this.submissionFileRulesService.safeSubmissionFileContentType(
          template.originalFileName,
        ),
      contentLength: template.sizeBytes,
    };
  }

  async downloadSubmissionFile(
    milestoneId: string,
    documentId: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<DownloadedMilestoneDocumentSubmissionFile> {
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const applicationProgramId =
      await this.repository.findApplicationProgramId(applicationId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

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
      fileName:
        this.milestoneDocumentRulesService.milestoneDocumentDownloadFileName({
          teamName: file.teamName,
          documentName: documentContext.name,
          originalFileName: file.originalFileName,
        }),
      contentType:
        this.submissionFileRulesService.safeSubmissionFileContentType(
          file.originalFileName,
        ),
      contentLength: file.sizeBytes,
    };
  }

  private async validateOriginalFileName(
    file: MilestoneDocumentFileUpload | undefined,
    purpose: 'STUDENT' | 'TEMPLATE' = 'STUDENT',
  ): Promise<string> {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.FILE_TOO_LARGE);
    }
    const normalizedFileName =
      this.submissionFileRulesService.normalizeMultipartFileName(
        file.originalname,
      );
    const valid =
      purpose === 'TEMPLATE'
        ? this.submissionFileRulesService.hasValidSubmissionTemplateSignature(
            file.buffer,
            normalizedFileName,
          )
        : this.submissionFileRulesService.isAllowedSubmissionFileType(
            normalizedFileName,
          ) &&
          this.submissionFileRulesService.hasValidSubmissionFileSignature(
            file.buffer,
            normalizedFileName,
          );
    if (!valid) {
      throw this.error(MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection =
        await this.submissionFileRulesService.inspectSubmissionZipMetadata(
          file.buffer,
        );
      if (zipRejection !== null) {
        throw this.error(
          MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[zipRejection],
        );
      }
    }
    return this.submissionFileRulesService.sanitizeSubmissionFileOriginalName(
      normalizedFileName,
    );
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
