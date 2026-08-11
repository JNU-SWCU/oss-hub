import type {
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
} from '@prisma/client';

export type ProgramAuthoringDocumentRequest = {
  readonly name: string;
  readonly required: boolean;
  readonly submissionType: MilestoneSubmissionType;
  readonly templateUploadId?: string | null;
};

export type ProgramAuthoringMilestoneRequest = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions?: string | null;
  readonly documents: readonly ProgramAuthoringDocumentRequest[];
};

export type ProgramAuthoringRequest = {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
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
  readonly submissionType: MilestoneSubmissionType;
  readonly templateUploadId: string | null;
};

export type ProgramAuthoringMilestonePlan = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string | null;
  readonly documents: readonly ProgramAuthoringDocumentPlan[];
};

export type ProgramAuthoringPlan = {
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

export type ProgramAuthoringValidationIssue = {
  readonly path: string;
  readonly code: string;
};

export class ProgramAuthoringValidationError extends Error {
  override readonly name = 'ProgramAuthoringValidationError';

  constructor(readonly issues: readonly ProgramAuthoringValidationIssue[]) {
    super('Program authoring request is invalid.');
  }
}

export class ProgramAuthoringIdempotencyConflictError extends Error {
  override readonly name = 'ProgramAuthoringIdempotencyConflictError';

  constructor(
    readonly actorId: string,
    readonly idempotencyKey: string,
  ) {
    super('The idempotency key was already used for another request.');
  }
}

export const PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE = {
  MISSING: 'MISSING',
  NOT_OWNED: 'NOT_OWNED',
  NOT_PENDING: 'NOT_PENDING',
  EXPIRED: 'EXPIRED',
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

export interface ProgramAuthoringTransactionStore {
  createProgram(
    plan: ProgramAuthoringProgramPlan,
  ): Promise<ProgramAuthoringProgram>;
  createRequest(input: ProgramAuthoringCreateRequestInput): Promise<string>;
  lockUploads(
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  createMilestone(
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string>;
  createDocument(
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string>;
  createTemplate(input: ProgramAuthoringTemplateInput): Promise<void>;
  attachUploads(
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void>;
}

export interface ProgramAuthoringRepositoryPort {
  findReplay(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ProgramAuthoringReplay | null>;
  withTransaction<T>(
    operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
  ): Promise<T>;
}
