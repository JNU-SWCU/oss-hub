const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

/**
 * 허용 확장자 목록 — 위 정본에서 직접 뽑는다. 화면의 `accept`도 이 목록에서 만들어야
 * 서버가 받는 것과 화면이 고르게 하는 것이 갈라지지 않는다(`submission-upload-policy.ts`).
 */
export const SUBMISSION_FILE_EXTENSIONS: readonly string[] = Object.keys(
  CANONICAL_CONTENT_TYPES,
);

function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

export function isAllowedSubmissionFileType(fileName: string): boolean {
  const extension = submissionFileExtension(fileName);
  return extension !== null && CANONICAL_CONTENT_TYPES[extension] !== undefined;
}

export function safeSubmissionFileContentType(fileName: string): string {
  const extension = submissionFileExtension(fileName);
  return extension === null
    ? 'application/octet-stream'
    : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
}
