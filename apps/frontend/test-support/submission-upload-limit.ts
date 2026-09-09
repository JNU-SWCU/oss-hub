import type { SubmissionUploadLimit } from '../src/lib/submission-upload-policy';

export function submissionUploadLimit(
  overrides: Partial<SubmissionUploadLimit> = {},
): SubmissionUploadLimit {
  return { maxBytes: 5 * 1024 * 1024, maxLabel: '5 MB', ...overrides };
}
