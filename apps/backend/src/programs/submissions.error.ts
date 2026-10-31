export class SubmissionPublicIdCollisionError extends Error {
  override readonly name = 'SubmissionPublicIdCollisionError';
}

export class SubmissionAlreadyExistsError extends Error {
  override readonly name = 'SubmissionAlreadyExistsError';
}

export class SubmissionFileUnavailableError extends Error {
  override readonly name = 'SubmissionFileUnavailableError';
}

export class StaleSubmissionRevisionError extends Error {
  override readonly name = 'StaleSubmissionRevisionError';
}

export class LegacySubmissionSlotMissingError extends Error {
  override readonly name = 'LegacySubmissionSlotMissingError';
}
