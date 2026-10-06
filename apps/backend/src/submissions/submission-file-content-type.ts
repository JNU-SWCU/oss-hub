const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

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
