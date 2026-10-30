import { randomUUID } from 'node:crypto';

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
