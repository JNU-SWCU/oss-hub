import { ValidatedProgramAuthoringUpload } from './program-authoring-upload-transaction.repository';
import {
  Inject,
  Injectable,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ObjectStoragePort } from '../platform/object-storage.types';
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
import { SubmissionFileAdmissionService } from './submission-file-admission.service';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  PROGRAM_COVER_MAX_BYTES,
} from './submission-upload.config';
import type { ProgramExternalCover } from './program-authoring-upload-transaction.repository';
import { ProgramAuthoringUploadTokenError } from './program-authoring.error';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';
import { ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { DomainException } from '../platform/error-code.error';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { randomUUID, createHash } from 'node:crypto';
import { extname } from 'node:path';

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
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly noticeClient: ProgramNoticeFetchClient,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  createProgramAuthoringObjectKey(): string {
    return `program-authoring/${randomUUID()}`;
  }

  async validateProgramAuthoringUpload(
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

    const originalFileName =
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        this.submissionFileAdmissionService.normalizeMultipartFileName(
          file.originalname,
        ),
      );
    if (
      !this.submissionFileAdmissionService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    if (
      originalFileName.toLowerCase().endsWith('.zip') &&
      (await this.submissionFileAdmissionService.inspectSubmissionZipMetadata(
        file.buffer,
      )) !== null
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

  createProgramCoverObjectKey(): string {
    return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
  }

  validateProgramCoverUpload(
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
    const originalFileName =
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        this.submissionFileAdmissionService.normalizeMultipartFileName(
          file.originalname,
        ),
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
      !this.submissionFileAdmissionService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
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

  validateProgramCoverChoice(input: {
    readonly coverUploadId?: string | null;
    readonly externalCover?: ProgramExternalCover | null;
  }): ProgramExternalCover | null | undefined {
    if (
      input.coverUploadId !== undefined &&
      input.externalCover !== undefined
    ) {
      throw new ProgramAuthoringValidationError([
        { path: 'externalCover', code: 'CONFLICTING_COVER_CHOICES' },
      ]);
    }
    if (input.externalCover == null) return input.externalCover;
    try {
      const source = this.noticeClient.parseProgramNoticeUrl(
        input.externalCover.sourceUrl,
      );
      const image = this.noticeClient.parseProgramNoticeImageUrl(
        input.externalCover.imageUrl,
        source,
      );
      if (image !== null)
        return { sourceUrl: source.href, imageUrl: image.href };
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
    }
    throw new ProgramAuthoringValidationError([
      { path: 'externalCover', code: 'INVALID_EXTERNAL_COVER' },
    ]);
  }

  assertProgramTemplateUpload(upload: ProgramAuthoringUploadToken): void {
    if (!upload.storageKey.startsWith('program-authoring/')) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  assertProgramCoverUpload(upload: ProgramAuthoringUploadToken): void {
    if (
      !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
      !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
      upload.sizeBytes < 1 ||
      upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
    ) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  async uploadFromRequest(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    try {
      return await this.upload(actorId, file);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async uploadCoverFromRequest(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    try {
      return await this.uploadCover(actorId, file);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async deleteFromRequest(actorId: string, id: string): Promise<void> {
    try {
      await this.delete(actorId, id);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async upload(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    if (!isOpaqueId(actorId)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      );
    }
    const validated = await this.validateProgramAuthoringUpload(file);
    return this.storeUpload(actorId, validated, () =>
      this.createProgramAuthoringObjectKey(),
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
      this.validateProgramCoverUpload(file),
      () => this.createProgramCoverObjectKey(),
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

function uploadHttpError(error: unknown): Error {
  if (!(error instanceof ProgramAuthoringUploadError)) throw error;
  switch (error.code) {
    case 'PROGRAM_AUTHORING_UPLOAD_NOT_FOUND':
      return new NotFoundException('Upload was not found.');
    case 'PROGRAM_AUTHORING_UPLOAD_ATTACHED_CONFLICT':
      return new ConflictException('Upload is already attached.');
    case 'PROGRAM_AUTHORING_UPLOAD_STORAGE_UNAVAILABLE':
      return new ConflictException('Upload storage is currently unavailable.');
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_ACTOR':
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_FILE':
    case 'PROGRAM_AUTHORING_UPLOAD_FILE_TOO_LARGE':
    case 'PROGRAM_AUTHORING_UPLOAD_UNSUPPORTED_FILE_TYPE':
      return new BadRequestException('Upload is invalid.');
  }
}

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
