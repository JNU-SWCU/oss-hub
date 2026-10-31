import { ProgramAuthoringUploadLifecycle } from '@prisma/client';

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
