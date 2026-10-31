import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../users/users-authority.service';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../platform/object-storage.types';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './submission-file.error';
import {
  SubmissionFilesService,
  inspectSubmissionZipMetadata,
} from './submission-files.service';
import {
  isAllowedSubmissionFileType,
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
  hasValidSubmissionFileSignature,
  hasValidSubmissionTemplateSignature,
  safeSubmissionFileContentType,
} from './submission-file.config';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { normalizeMultipartFileName } from '../platform/multipart-file-upload.interceptor';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { milestoneDocumentSubmissionBlock } from './milestone-documents.service';

const UNSAFE_CHARACTERS = new Set([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  ';',
  ',',
  "'",
]);

const FALLBACK_SEGMENT = 'file';

const MAX_SEGMENT_UNITS = 100;

const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${index + 1}`),
]);

export interface MilestoneDocumentDownloadFileNameInput {
  readonly teamName: string;
  readonly documentName: string;
  readonly originalFileName: string;
}

export function milestoneDocumentDownloadFileName(
  input: MilestoneDocumentDownloadFileNameInput,
): string {
  return `${baseName(input)}${extensionOf(input.originalFileName)}`;
}

export function milestoneDocumentTextEntryFileName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${baseName(input)}.txt`;
}

export function milestoneDocumentArchiveFolderName(value: string): string {
  const segment = safeSegment(value);

  const stem = segment.split('.')[0] ?? segment;
  return WINDOWS_RESERVED_NAMES.has(normalizeDeviceDigits(stem).toUpperCase())
    ? `${segment}_`
    : segment;
}

function normalizeDeviceDigits(value: string): string {
  return value.replace(/[¹²³]/g, (character) =>
    String({ '¹': 1, '²': 2, '³': 3 }[character] ?? character),
  );
}

function baseName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${safeSegment(input.teamName)}_${safeSegment(input.documentName)}`;
}

function replaceUnsafe(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;

      if (code < 0x20 || code === 0x7f) return '_';
      if (isInvisibleFormatting(code)) return '_';
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

function isInvisibleFormatting(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function safeSegment(value: string): string {
  const normalized = truncate(replaceUnsafe(value).replace(/\s+/g, ' ').trim())
    .replace(/\.+$/, '')
    .trim();

  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
}

function truncate(value: string): string {
  if (value.length <= MAX_SEGMENT_UNITS) return value;
  let units = 0;
  let cut = '';
  for (const character of value) {
    if (units + character.length > MAX_SEGMENT_UNITS) break;
    units += character.length;
    cut += character;
  }
  return cut.trim();
}

function extensionOf(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf('.');
  if (dot <= 0 || dot === originalFileName.length - 1) return '';
  const extension = replaceUnsafe(originalFileName.slice(dot + 1)).replace(
    /\s+/g,
    '',
  );
  return extension.length > 0 ? `.${extension}` : '';
}

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
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

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

    const blocked = milestoneDocumentSubmissionBlock({
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
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    const { actorId } = await this.authority.assertActiveStaff(
      sessionGithubId,
      () => this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
      contentType: safeSubmissionFileContentType(template.originalFileName),
      contentLength: template.sizeBytes,
    };
  }

  async downloadSubmissionFile(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<DownloadedMilestoneDocumentSubmissionFile> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
      fileName: milestoneDocumentDownloadFileName({
        teamName: file.teamName,
        documentName: documentContext.name,
        originalFileName: file.originalFileName,
      }),
      contentType: safeSubmissionFileContentType(file.originalFileName),
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
    const normalizedFileName = normalizeMultipartFileName(file.originalname);
    const valid =
      purpose === 'TEMPLATE'
        ? hasValidSubmissionTemplateSignature(file.buffer, normalizedFileName)
        : isAllowedSubmissionFileType(normalizedFileName) &&
          hasValidSubmissionFileSignature(file.buffer, normalizedFileName);
    if (!valid) {
      throw this.error(MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

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
