export class SubmissionFileRetentionUnavailableError extends Error {
  override readonly name = 'SubmissionFileRetentionUnavailableError';
}

export class SubmissionFileQuotaExceededError extends Error {
  override readonly name = 'SubmissionFileQuotaExceededError';
}
