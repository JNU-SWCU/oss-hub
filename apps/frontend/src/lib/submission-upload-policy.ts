export interface SubmissionUploadLimit {
  readonly maxBytes: number;
  readonly maxLabel: string;
}

export function requireSubmissionUploadLimit(
  value: unknown,
): SubmissionUploadLimit {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('maxBytes' in value) ||
    typeof value.maxBytes !== 'number' ||
    !Number.isFinite(value.maxBytes) ||
    value.maxBytes <= 0 ||
    !('maxLabel' in value) ||
    typeof value.maxLabel !== 'string' ||
    value.maxLabel.trim().length === 0
  )
    throw new TypeError('Invalid submission upload limit response');
  return { maxBytes: value.maxBytes, maxLabel: value.maxLabel };
}

export function submissionUploadTooLargeMessage(
  policy: SubmissionUploadLimit,
): string {
  return `파일은 ${policy.maxLabel} 이하여야 합니다.`;
}
