import { hasValidSubmissionFileSignature } from './submission-file-signature';

const IMAGE_SIGNATURES: Readonly<Record<string, Buffer>> = {
  '.jpg': Buffer.from([0xff, 0xd8, 0xff]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export const SUBMISSION_TEMPLATE_ACCEPT = '.pdf,.hwp,.jpg,.jpeg,.png,.zip';
export const SUBMISSION_TEMPLATE_FORMAT_LABEL = 'PDF, HWP, JPG, PNG, ZIP';

/** Staff templates retain images; student admission never calls this policy. */
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
