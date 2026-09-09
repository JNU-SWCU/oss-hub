/** 서버 응답으로 받은 파일 크기 제한. 화면은 자체 기본값을 두지 않는다. */
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
