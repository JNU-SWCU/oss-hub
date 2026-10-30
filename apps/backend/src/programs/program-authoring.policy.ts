import { randomUUID, createHash } from 'node:crypto';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { DomainException } from '../platform/error-code.error';
import {
  parseProgramNoticeImageUrl,
  parseProgramNoticeUrl,
} from './program-notice.policy';
import type {
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
  ProgramTrackType,
} from '@prisma/client';
import { normalizeMultipartFileName } from '../platform/platform.policy';
import {
  sanitizeSubmissionFileOriginalName,
  hasValidSubmissionTemplateSignature,
  SUBMISSION_UPLOAD_MAX_BYTES,
} from './submission-file.policy';
import { inspectSubmissionZipMetadata } from './submission-zip-admission.policy';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';

export function createProgramAuthoringObjectKey(): string {
  return `program-authoring/${randomUUID()}`;
}

export type ProgramExternalCover = {
  readonly sourceUrl: string;
  readonly imageUrl: string;
};

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

export type ProgramAuthoringDocumentRequest = {
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string | null;
};

export type ProgramAuthoringMilestoneRequest = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
  readonly documents: readonly ProgramAuthoringDocumentRequest[];
};

export type ProgramAuthoringRequest = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt?: string;
  readonly endAt: string;
  readonly teamMinSize?: number | null;
  readonly teamMaxSize?: number | null;
  readonly description: string;
  readonly repositoryProvisioningEnabled?: boolean;
  readonly notifyOnDeadline?: boolean;
  readonly milestones: readonly ProgramAuthoringMilestoneRequest[];
};

export type ProgramAuthoringProgramPlan = {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export type ProgramAuthoringDocumentPlan = {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateUploadId: string;
};

export type ProgramAuthoringMilestonePlan = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly instructions: string | null;
  readonly documents: readonly ProgramAuthoringDocumentPlan[];
};

export type ProgramAuthoringPlan = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover;
  readonly program: ProgramAuthoringProgramPlan;
  readonly milestones: readonly ProgramAuthoringMilestonePlan[];
  readonly uploadTokenIds: readonly string[];
};

export type ProgramAuthoringProgram = ProgramAuthoringProgramPlan & {
  readonly id: string;
  readonly lifecycle: ProgramLifecycle;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ProgramAuthoringReplay = {
  readonly payloadHash: string;
  readonly program: ProgramAuthoringProgram;
};

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

export class ProgramAuthoringIdempotencyConflictError extends Error {
  override readonly name = 'ProgramAuthoringIdempotencyConflictError';

  constructor(
    readonly actorId: string,
    readonly idempotencyKey: string,
    readonly existingProgramId: string,
  ) {
    super('The idempotency key was already used for another request.');
  }
}

export const PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE = {
  MISSING: 'MISSING',
  NOT_OWNED: 'NOT_OWNED',
  NOT_PENDING: 'NOT_PENDING',
  EXPIRED: 'EXPIRED',
  WRONG_PURPOSE: 'WRONG_PURPOSE',
} as const;

export type ProgramAuthoringUploadTokenFailure =
  (typeof PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE)[keyof typeof PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE];

export class ProgramAuthoringUploadTokenError extends Error {
  override readonly name = 'ProgramAuthoringUploadTokenError';

  constructor(
    readonly reason: ProgramAuthoringUploadTokenFailure,
    readonly tokenIds: readonly string[],
  ) {
    super('Program authoring upload tokens are not attachable.');
  }
}

export class ProgramAuthoringIdempotencyRaceError extends Error {
  override readonly name = 'ProgramAuthoringIdempotencyRaceError';

  constructor(cause: unknown) {
    super('The idempotency gate was won by another transaction.', { cause });
  }
}

export type ProgramAuthoringCreateRequestInput = {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly programId: string;
};

export type ProgramAuthoringTemplateInput = {
  readonly milestoneDocumentId: string;
  readonly actorId: string;
  readonly upload: ProgramAuthoringUploadToken;
};

export type ProgramAuthoringPendingUploadConsumption = {
  readonly milestoneDocumentId: string;
  readonly upload: ProgramAuthoringUploadToken;
};

export class ProgramAuthoringUploadConsumptionRaceError extends Error {
  override readonly name = 'ProgramAuthoringUploadConsumptionRaceError';

  constructor(readonly uploadId: string) {
    super('Program authoring upload changed before consumption.');
  }
}

export function canonicalProgramAuthoringPayload(plan: ProgramAuthoringPlan) {
  return {
    schemaVersion: 2,
    ...(plan.coverUploadId ? { coverUploadId: plan.coverUploadId } : {}),
    ...(plan.externalCover ? { externalCover: plan.externalCover } : {}),
    program: {
      name: plan.program.name,
      organizer: plan.program.organizer,
      trackType: plan.program.trackType,
      category: plan.program.category,
      applicationTemplateKey: plan.program.applicationTemplateKey,
      applicationTemplateVersion: plan.program.applicationTemplateVersion,
      applicationStartAt: plan.program.applicationStartAt.toISOString(),
      applicationEndAt: plan.program.applicationEndAt.toISOString(),
      startAt: plan.program.startAt.toISOString(),
      endAt: plan.program.endAt.toISOString(),
      teamMinSize: plan.program.teamMinSize,
      teamMaxSize: plan.program.teamMaxSize,
      description: plan.program.description,
      repositoryProvisioningEnabled: plan.program.repositoryProvisioningEnabled,
      notifyOnDeadline: plan.program.notifyOnDeadline,
    },
    milestones: plan.milestones.map((milestone) => ({
      name: milestone.name,
      startAt: milestone.startAt.toISOString(),
      dueAt: milestone.dueAt.toISOString(),
      submissionType: milestone.submissionType,
      instructions: milestone.instructions,
      documents: milestone.documents.map((document) => ({
        name: document.name,
        required: document.required,
        sortOrder: document.sortOrder,
        templateUploadId: document.templateUploadId,
      })),
    })),
  } as const;
}

export function hashProgramAuthoringPayload(
  plan: ProgramAuthoringPlan,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalProgramAuthoringPayload(plan)), 'utf8')
    .digest('hex');
}

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export interface ValidatedProgramAuthoringUpload {
  readonly body: Buffer;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

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
