import { Inject, Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import { DomainException } from '../common/error-code';
import { hasProgramDeadlinePassed } from '../programs/program-deadline';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from './submission-file-name';
import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from './submission-file-content-type';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import {
  type CreatePendingSubmissionFileInput,
  type SubmissionFileResubmissionContext,
  SubmissionFileRetentionUnavailableError,
  SubmissionFilesRepository,
} from './submission-files.repository';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface SubmissionFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface UploadedSubmissionFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface DownloadedSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

@Injectable()
export class SubmissionFilesService {
  constructor(
    private readonly repository: SubmissionFilesRepository,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
  ) {}

  async upload(
    sessionGithubId: bigint,
    applicationId: unknown,
    milestoneId: unknown,
    file: SubmissionFileUpload | undefined,
    submissionId?: unknown,
    baseRevision?: unknown,
  ): Promise<UploadedSubmissionFileResponse> {
    const normalizedApplicationId = this.requiredOpaqueId(applicationId);
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    const resubmissionContext = this.optionalResubmissionContext(
      submissionId,
      baseRevision,
    );
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(SubmissionsErrorCode.FILE_TOO_LARGE);
    }
    if (
      !isAllowedSubmissionFileType(file.originalname, file.mimetype) ||
      !hasValidFileSignature(file.buffer, file.originalname)
    ) {
      throw this.error(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    const uploaderId =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (uploaderId === null) {
      throw this.error(SubmissionsErrorCode.STUDENT_ONLY);
    }
    const authorization = await this.repository.findUploadAuthorization(
      uploaderId,
      normalizedApplicationId,
      normalizedMilestoneId,
      resubmissionContext,
    );
    if (authorization === null) {
      throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!authorization.applicationApproved) {
      throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
    }
    if (authorization.submissionType !== MilestoneSubmissionType.FILE) {
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    }
    const now = new Date();
    if (resubmissionContext !== null) {
      // 교체 허용 조건은 submissions.service.ts 의 assertResubmittable 과 같은 계약이다.
      // 보완 요청은 마감과 무관하게 열리고, 아직 판정 전(SUBMITTED)이면 마감 전까지 교체할 수 있다.
      // 여기서만 CHANGES_REQUESTED 로 좁히면 체크리스트가 canResubmit=true 로 안내하는데
      // FILE 유형만 업로드 단계에서 막혀 학생이 잘못 낸 파일을 마감 전에 고칠 수 없다.
      const status = authorization.resubmissionStatus;
      const replaceableBeforeDue =
        status === SubmissionStatus.SUBMITTED &&
        !hasProgramDeadlinePassed(authorization.dueAt, now);
      if (
        status !== SubmissionStatus.CHANGES_REQUESTED &&
        !replaceableBeforeDue
      ) {
        throw this.error(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
      }
      if (authorization.currentRevision !== resubmissionContext.baseRevision) {
        throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
      }
    }

    if (
      resubmissionContext === null &&
      hasProgramDeadlinePassed(authorization.dueAt, now)
    ) {
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    }
    if (authorization.programEndAt === null) {
      throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
    }

    const objectKey = createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(file.originalname);
    const pendingInput: CreatePendingSubmissionFileInput = {
      uploaderId,
      applicationId: normalizedApplicationId,
      milestoneId: normalizedMilestoneId,
      storageKey: objectKey,
      originalFileName: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.byteLength,
      pendingExpiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    };

    let created;
    try {
      created = await this.repository.createPending(pendingInput);
    } catch (error) {
      if (error instanceof SubmissionFileRetentionUnavailableError) {
        throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
      }
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    try {
      await this.storage.put({
        body: file.buffer,
        contentType: file.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      fileId: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt!.toISOString(),
    };
  }

  async download(
    sessionGithubId: bigint,
    fileId: string,
    now: Date = new Date(),
  ): Promise<DownloadedSubmissionFile> {
    if (fileId.length === 0 || fileId !== fileId.trim()) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }
    const file = await this.repository.findDownloadableFile(
      sessionGithubId,
      fileId,
      now,
    );
    if (file === null) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch {
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      body,
      fileName: file.originalFileName,
      contentType: safeSubmissionFileContentType(
        file.originalFileName,
        file.mimeType,
      ),
      contentLength: file.sizeBytes,
    };
  }

  private requiredOpaqueId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim()
    ) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    return value;
  }

  private optionalResubmissionContext(
    submissionId: unknown,
    baseRevision: unknown,
  ): SubmissionFileResubmissionContext | null {
    if (submissionId === undefined && baseRevision === undefined) {
      return null;
    }
    return {
      submissionId: this.requiredOpaqueId(submissionId),
      baseRevision: this.requiredPositiveInteger(baseRevision),
    };
  }

  private requiredPositiveInteger(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 1) return value;
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim() ||
      !/^[1-9]\d*$/.test(value)
    ) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    const numericValue = Number(value);
    if (!Number.isSafeInteger(numericValue)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    return numericValue;
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

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
