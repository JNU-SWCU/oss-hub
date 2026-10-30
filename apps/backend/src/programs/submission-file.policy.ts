import { randomUUID } from 'node:crypto';

const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

const SUBMISSION_FILE_EXTENSIONS = ['.pdf', '.hwp', '.zip'] as const;

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

const MAX_ORIGINAL_NAME_LENGTH = 255;
const IS_SAFE_CHARACTER = (character: string): boolean => {
  const characterCode = character.charCodeAt(0);
  return characterCode > 0x1f && characterCode !== 0x7f;
};

export function createSubmissionFileObjectKey(): string {
  return `submission-files/${randomUUID()}`;
}

export function sanitizeSubmissionFileOriginalName(name: string): string {
  const baseName = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const sanitized = [...baseName]
    .filter(IS_SAFE_CHARACTER)
    .join('')
    .trim()
    .slice(0, MAX_ORIGINAL_NAME_LENGTH);

  return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..'
    ? sanitized
    : 'file';
}

const FILE_SIGNATURES: Readonly<Record<string, readonly Buffer[]>> = {
  '.pdf': [Buffer.from('%PDF-')],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.zip': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ],
};

export function hasValidSubmissionFileSignature(
  buffer: Buffer,
  fileName: string,
): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return (
    FILE_SIGNATURES[extension]?.some(
      (signature) =>
        buffer.length >= signature.length &&
        buffer.subarray(0, signature.length).equals(signature),
    ) ?? false
  );
}

const IMAGE_SIGNATURES: Readonly<Record<string, Buffer>> = {
  '.jpg': Buffer.from([0xff, 0xd8, 0xff]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export const SUBMISSION_TEMPLATE_ACCEPT = '.pdf,.hwp,.jpg,.jpeg,.png,.zip';
export const SUBMISSION_TEMPLATE_FORMAT_LABEL = 'PDF, HWP, JPG, PNG, ZIP';

export function hasValidSubmissionTemplateSignature(
  buffer: Buffer,
  fileName: string,
): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return false;
  const signature = IMAGE_SIGNATURES[fileName.slice(dot).toLowerCase()];
  return signature === undefined
    ? hasValidSubmissionFileSignature(buffer, fileName)
    : buffer.subarray(0, signature.length).equals(signature);
}

export const SUBMISSION_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export const SUBMISSION_UPLOAD_MAX_LABEL = '5 MB';

export const SUBMISSION_UPLOAD_ACCEPT = SUBMISSION_FILE_EXTENSIONS.join(',');

const EXTENSION_LABELS: Readonly<Record<string, string>> = {
  '.jpeg': 'JPG',
};

export const SUBMISSION_UPLOAD_FORMAT_LABEL = [
  ...new Set(
    SUBMISSION_FILE_EXTENSIONS.map(
      (extension) =>
        EXTENSION_LABELS[extension] ?? extension.slice(1).toUpperCase(),
    ),
  ),
].join(', ');

export const SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE = `파일은 ${SUBMISSION_UPLOAD_MAX_LABEL} 이하여야 합니다.`;
