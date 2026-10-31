import { SUBMISSION_FILE_EXTENSIONS } from './submission-upload.config';
import { randomUUID } from 'node:crypto';
const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

export function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

export function safeSubmissionFileContentType(fileName: string): string {
  const extension = submissionFileExtension(fileName);
  return extension === null
    ? 'application/octet-stream'
    : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
}

export interface SubmissionPublicIdentity {
  readonly id: string;
  readonly legacySubmissionId: string | null;
}

export function publicSubmissionId(identity: SubmissionPublicIdentity): string {
  return identity.legacySubmissionId ?? identity.id;
}

export function addOneCalendarYear(value: Date): Date {
  const result = new Date(value);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (month === 1 && result.getUTCMonth() !== month) {
    result.setUTCDate(0);
  }
  return result;
}

const ALLOWED_SUBMISSION_EXTENSIONS = new Set<string>(
  SUBMISSION_FILE_EXTENSIONS,
);

export function isAllowedSubmissionFileType(fileName: string): boolean {
  const extension = submissionFileExtension(fileName);
  return extension !== null && ALLOWED_SUBMISSION_EXTENSIONS.has(extension);
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
