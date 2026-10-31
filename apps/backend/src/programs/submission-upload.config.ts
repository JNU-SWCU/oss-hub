export const SUBMISSION_FILE_EXTENSIONS = ['.pdf', '.hwp', '.zip'] as const;

export const SUBMISSION_TEMPLATE_ACCEPT = '.pdf,.hwp,.jpg,.jpeg,.png,.zip';

export const SUBMISSION_TEMPLATE_FORMAT_LABEL = 'PDF, HWP, JPG, PNG, ZIP';

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

export const PROGRAM_COVER_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
