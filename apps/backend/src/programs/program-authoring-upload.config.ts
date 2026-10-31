import { ProgramAuthoringUploadLifecycle } from '@prisma/client';
import { ProgramAuthoringUploadTokenError } from './program-authoring.error';
import { PROGRAM_COVER_MAX_BYTES } from './submission-upload.config';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';

export type ProgramAuthoringUploadToken = {
  readonly id: string;
  readonly actorId: string;
  readonly lifecycle: ProgramAuthoringUploadLifecycle;
  readonly unexpired: boolean;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export function assertProgramTemplateUpload(
  upload: ProgramAuthoringUploadToken,
): void {
  if (!upload.storageKey.startsWith('program-authoring/')) {
    throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
  }
}

export function assertProgramCoverUpload(
  upload: ProgramAuthoringUploadToken,
): void {
  if (
    !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
    !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
    upload.sizeBytes < 1 ||
    upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
  ) {
    throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
  }
}
