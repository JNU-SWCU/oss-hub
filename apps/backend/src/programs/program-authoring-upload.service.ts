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
import { ProgramUploadRulesService } from './program-upload-rules.service';

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
    private readonly programUploadRulesService: ProgramUploadRulesService,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    const validated =
      await this.programUploadRulesService.validateProgramAuthoringUpload(file);
    return this.storeUpload(actorId, validated, () =>
      this.programUploadRulesService.createProgramAuthoringObjectKey(),
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
      this.programUploadRulesService.validateProgramCoverUpload(file),
      () => this.programUploadRulesService.createProgramCoverObjectKey(),
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
