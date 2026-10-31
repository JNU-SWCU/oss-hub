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

export class ProgramAuthoringUploadConsumptionRaceError extends Error {
  override readonly name = 'ProgramAuthoringUploadConsumptionRaceError';

  constructor(readonly uploadId: string) {
    super('Program authoring upload changed before consumption.');
  }
}

export class ProgramAuthoringAttachmentRaceError extends Error {
  override readonly name = 'ProgramAuthoringAttachmentRaceError';

  constructor() {
    super('Program authoring uploads changed before attachment.');
  }
}
export class ProgramAuthoringForbiddenError extends Error {
  override readonly name = 'ProgramAuthoringForbiddenError';

  constructor() {
    super('Program authoring requires staff or administrator access.');
  }
}
