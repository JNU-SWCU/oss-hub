import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  ProgramAuthoringUploadRepository,
  type ProgramAuthoringUploadDeleteRequestResult,
} from './program-authoring-upload.repository';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
  type ProgramAuthoringUploadResponse,
} from './program-authoring-upload.types';
import { validateProgramAuthoringUpload } from './program-authoring-upload.validation';

const PENDING_TTL_MS = 24 * 60 * 60 * 1_000;

type ProgramAuthoringUploadStore = Pick<
  ProgramAuthoringUploadRepository,
  'createPending' | 'requestDelete'
>;
type ProgramAuthoringUploadStorage = Pick<SubmissionFileStoragePort, 'put'>;

@Injectable()
export class ProgramAuthoringUploadService {
  constructor(
    @Inject(ProgramAuthoringUploadRepository)
    private readonly repository: ProgramAuthoringUploadStore,
    @Inject(SUBMISSION_FILE_STORAGE)
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
    const validated = validateProgramAuthoringUpload(file);
    const createdAt = this.now();
    const storageKey = `program-authoring/${randomUUID()}`;

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
