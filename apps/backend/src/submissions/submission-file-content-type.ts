const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

/**
 * 새 제출에 허용하는 확장자 목록. 화면의 `accept`도 이 목록에서 만들어야 서버가 받는 것과
 * 화면이 고르게 하는 것이 갈라지지 않는다(`submission-upload-policy.ts`).
 *
 * 이미지 MIME 매핑은 기존 제출의 안전한 다운로드를 위해 위 정본에 남기되, 새 업로드는
 * 교직원이 후속 작업에 사용하는 PDF, HWP, ZIP으로 제한한다.
 */
export const SUBMISSION_FILE_EXTENSIONS = ['.pdf', '.hwp', '.zip'] as const;

const ALLOWED_SUBMISSION_EXTENSIONS = new Set<string>(
  SUBMISSION_FILE_EXTENSIONS,
);

function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

export function isAllowedSubmissionFileType(fileName: string): boolean {
  const extension = submissionFileExtension(fileName);
  return extension !== null && ALLOWED_SUBMISSION_EXTENSIONS.has(extension);
}

export function safeSubmissionFileContentType(fileName: string): string {
  const extension = submissionFileExtension(fileName);
  return extension === null
    ? 'application/octet-stream'
    : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
}
