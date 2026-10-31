import { DomainException } from '../platform/error-code.error';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import type { ProgramExternalCover } from './program-authoring-upload-transaction.repository';
import {
  parseProgramNoticeUrl,
  parseProgramNoticeImageUrl,
} from './program-notice-fetch.client';
import {
  PROGRAM_COVER_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_BYTES,
} from './submission-upload.config';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  ProgramAuthoringUploadRepository,
  type ProgramAuthoringUploadDeleteRequestResult,
} from './program-authoring-upload.repository';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
  type ProgramAuthoringUploadResponse,
} from './program-authoring-upload.error';
import { randomUUID, createHash } from 'node:crypto';
import { ValidatedProgramAuthoringUpload } from './program-authoring-upload-transaction.repository';
import { inspectSubmissionZipMetadata } from './submission-files.service';
import {
  sanitizeSubmissionFileOriginalName,
  hasValidSubmissionTemplateSignature,
} from './submission-file.config';
import { normalizeMultipartFileName } from '../platform/multipart-file-upload.interceptor';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';
import { extname } from 'node:path';

export function createProgramAuthoringObjectKey(): string {
  return `program-authoring/${randomUUID()}`;
}

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export async function validateProgramAuthoringUpload(
  file: ProgramAuthoringUploadFile | undefined,
): Promise<ValidatedProgramAuthoringUpload> {
  if (
    file === undefined ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.byteLength === 0 ||
    file.size !== file.buffer.byteLength
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
    );
  }
  if (file.buffer.byteLength > PROGRAM_AUTHORING_UPLOAD_MAX_BYTES) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
    );
  }

  const originalFileName = sanitizeSubmissionFileOriginalName(
    normalizeMultipartFileName(file.originalname),
  );
  if (!hasValidSubmissionTemplateSignature(file.buffer, originalFileName)) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }

  if (
    originalFileName.toLowerCase().endsWith('.zip') &&
    (await inspectSubmissionZipMetadata(file.buffer)) !== null
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }

  return {
    body: file.buffer,
    originalFileName,
    mimeType: file.mimetype.toLowerCase(),
    sizeBytes: file.buffer.byteLength,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

export function createProgramCoverObjectKey(): string {
  return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
}

export function validateProgramCoverUpload(
  file: ProgramAuthoringUploadFile | undefined,
): ValidatedProgramAuthoringUpload {
  if (
    file === undefined ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.byteLength === 0 ||
    file.size !== file.buffer.byteLength
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
    );
  }
  if (file.size > PROGRAM_COVER_MAX_BYTES) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
    );
  }
  const originalFileName = sanitizeSubmissionFileOriginalName(
    normalizeMultipartFileName(file.originalname),
  );
  const extension = extname(originalFileName).toLowerCase();
  const mimeType =
    extension === '.png'
      ? 'image/png'
      : extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : null;
  if (
    mimeType === null ||
    file.mimetype.toLowerCase() !== mimeType ||
    !hasValidSubmissionTemplateSignature(file.buffer, originalFileName)
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }
  return {
    body: file.buffer,
    originalFileName,
    mimeType,
    sizeBytes: file.size,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1_000;

type ProgramAuthoringUploadStore = Pick<
  ProgramAuthoringUploadRepository,
  'createPending' | 'requestDelete'
>;
type ProgramAuthoringUploadStorage = Pick<ObjectStoragePort, 'put'>;

@Injectable()
export class ProgramAuthoringUploadService {
  constructor(
    @Inject(ProgramAuthoringUploadRepository)
    private readonly repository: ProgramAuthoringUploadStore,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ProgramAuthoringUploadStorage,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  async upload(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    if (!isOpaqueId(actorId)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      );
    }
    const validated = await validateProgramAuthoringUpload(file);
    return this.storeUpload(
      actorId,
      validated,
      createProgramAuthoringObjectKey,
    );
  }

  async uploadCover(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    if (!isOpaqueId(actorId)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      );
    }
    return this.storeUpload(
      actorId,
      validateProgramCoverUpload(file),
      createProgramCoverObjectKey,
    );
  }

  private async storeUpload(
    actorId: string,
    validated: ValidatedProgramAuthoringUpload,
    createObjectKey: () => string,
  ): Promise<ProgramAuthoringUploadResponse> {
    const createdAt = this.now();
    const storageKey = createObjectKey();

    let created;
    try {
      created = await this.repository.createPending({
        actorId,
        storageKey,
        originalFileName: validated.originalFileName,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        expiresAt: new Date(createdAt.getTime() + PENDING_TTL_MS),
      });
    } catch {
      throw this.unavailable();
    }

    try {
      await this.storage.put({
        body: validated.body,
        contentType: validated.mimeType,
        originalName: validated.originalFileName,
        objectKey: storageKey,
      });
    } catch {
      throw this.unavailable();
    }

    return {
      id: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  async delete(actorId: string, id: string): Promise<void> {
    if (!isOpaqueId(actorId) || !isOpaqueId(id)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.NOT_FOUND,
      );
    }
    const result = await this.repository.requestDelete(actorId, id, this.now());
    this.handleDeleteResult(result);
  }

  private handleDeleteResult(
    result: ProgramAuthoringUploadDeleteRequestResult,
  ): void {
    switch (result.kind) {
      case 'QUEUED':
      case 'IDEMPOTENT':
        return;
      case 'NOT_FOUND':
        throw new ProgramAuthoringUploadError(
          PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.NOT_FOUND,
        );
      case 'ATTACHED':
        throw new ProgramAuthoringUploadError(
          PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.ATTACHED_CONFLICT,
        );
    }
  }

  private unavailable(): ProgramAuthoringUploadError {
    return new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.STORAGE_UNAVAILABLE,
    );
  }
}

function isOpaqueId(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

export function validateProgramCoverChoice(input: {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
}): ProgramExternalCover | null | undefined {
  if (input.coverUploadId !== undefined && input.externalCover !== undefined) {
    throw new ProgramAuthoringValidationError([
      { path: 'externalCover', code: 'CONFLICTING_COVER_CHOICES' },
    ]);
  }
  if (input.externalCover == null) return input.externalCover;
  try {
    const source = parseProgramNoticeUrl(input.externalCover.sourceUrl);
    const image = parseProgramNoticeImageUrl(
      input.externalCover.imageUrl,
      source,
    );
    if (image !== null) return { sourceUrl: source.href, imageUrl: image.href };
  } catch (error) {
    if (!(error instanceof DomainException)) throw error;
  }
  throw new ProgramAuthoringValidationError([
    { path: 'externalCover', code: 'INVALID_EXTERNAL_COVER' },
  ]);
}
