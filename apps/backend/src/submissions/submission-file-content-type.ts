const ALLOWED_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.hwp': ['application/x-hwp'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.zip': ['application/zip'],
};

export function isAllowedSubmissionFileType(
  fileName: string,
  mimeType: string,
): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return false;
  const extension = fileName.slice(dot).toLowerCase();
  return (
    ALLOWED_FILE_TYPES[extension]?.includes(mimeType.toLowerCase()) ?? false
  );
}

export function safeSubmissionFileContentType(
  fileName: string,
  mimeType: string,
): string {
  return isAllowedSubmissionFileType(fileName, mimeType)
    ? mimeType.toLowerCase()
    : 'application/octet-stream';
}
