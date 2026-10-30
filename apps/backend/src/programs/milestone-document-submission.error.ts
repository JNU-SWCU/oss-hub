export class MilestoneDocumentPendingFileMissingError extends Error {
  override readonly name = 'MilestoneDocumentPendingFileMissingError';
}

export class MilestoneDocumentReviewChangedError extends Error {
  override readonly name = 'MilestoneDocumentReviewChangedError';
}

export class MilestoneDocumentDeadlineClosedError extends Error {
  override readonly name = 'MilestoneDocumentDeadlineClosedError';
}

export class MilestoneDocumentSubmissionChangedError extends Error {
  override readonly name = 'MilestoneDocumentSubmissionChangedError';
}

export class MilestoneDocumentMissingError extends Error {
  override readonly name = 'MilestoneDocumentMissingError';
}
