import {
  submissionUploadTooLargeMessage,
  type SubmissionUploadLimit,
} from '@/lib/submission-upload-policy';
import type { SubmissionType } from './types';

export const SUBMISSION_FILE_ACCEPT = '.pdf,.hwp,.zip';

const SUBMISSION_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.hwp',
  '.zip',
]);

export interface SubmissionFormInput {
  readonly file: File | null;
  readonly text: string;
}

export interface SubmissionFormErrors {
  readonly file?: string;
  readonly text?: string;
}

export type SubmissionFileValidation =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const SUBMISSION_FILE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  SUB_017:
    '제출 요청이 서버에 온전히 전달되지 않았습니다. 파일을 다시 선택해 제출해 보고, 그래도 안 되면 프로그램 상세에서 해당 마일스톤의 제출 화면을 다시 열어 주세요.',
  SUB_018: 'PDF, HWP, ZIP 파일만 제출할 수 있습니다.',
  SUB_020: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  SUB_021:
    '프로그램 종료일이 설정되지 않아 파일을 제출할 수 없습니다. 담당 교직원에게 확인해 주세요.',
};

export const SUBMISSION_ARCHIVE_ERROR_CODES: ReadonlySet<string> = new Set([
  'SUB_025',
  'SUB_026',
  'SUB_027',
  'SUB_028',
  'SUB_029',
  'SUB_030',
  'SUB_031',
  'SUB_032',
]);

export function isSubmissionArchiveErrorCode(code: string): boolean {
  return SUBMISSION_ARCHIVE_ERROR_CODES.has(code);
}

const STALE_SUBMISSION_FORM_CODES = new Set(['SUB_005', 'SUB_006']);

export function isStaleSubmissionFormErrorCode(code: string): boolean {
  return STALE_SUBMISSION_FORM_CODES.has(code);
}
export class SubmissionFileUploadCache {
  private current: { readonly file: File; readonly fileId: string } | null =
    null;

  async resolve(
    file: File,
    upload: () => Promise<{ readonly fileId: string }>,
  ): Promise<string> {
    if (this.current?.file === file) return this.current.fileId;
    const uploaded = await upload();
    this.current = { file, fileId: uploaded.fileId };
    return uploaded.fileId;
  }

  discard(): void {
    this.current = null;
  }

  discardUnless(file: File | null): void {
    if (this.current?.file !== file) this.discard();
  }
}

export function getSubmissionFileErrorMessage(
  code: string,
  policy: SubmissionUploadLimit,
): string | null {
  if (code === 'SUB_019') return submissionUploadTooLargeMessage(policy);
  return SUBMISSION_FILE_ERROR_MESSAGES[code] ?? null;
}

export function submissionFileCheckMessage(
  problem: { readonly code: string; readonly detail: string },
  policy: SubmissionUploadLimit,
): string | null {
  return isSubmissionArchiveErrorCode(problem.code)
    ? problem.detail
    : getSubmissionFileErrorMessage(problem.code, policy);
}

export const SUBMISSION_FIELD_IDS = {
  FILE: 'submission-file',
  TEXT: 'submission-text',
} as const satisfies Readonly<Record<SubmissionType, string>>;

export function focusSubmissionField(submissionType: SubmissionType): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(SUBMISSION_FIELD_IDS[submissionType]);
  if (target instanceof HTMLElement) target.focus();
}

export function validateSubmissionFile(
  file: File | null,
  policy: SubmissionUploadLimit,
): SubmissionFileValidation {
  if (file === null) {
    return { ok: false, message: '제출할 파일을 선택해 주세요.' };
  }
  if (file.size > policy.maxBytes) {
    return {
      ok: false,
      message: submissionUploadTooLargeMessage(policy),
    };
  }

  const extensionStart = file.name.lastIndexOf('.');
  const extension =
    extensionStart < 0 ? '' : file.name.slice(extensionStart).toLowerCase();
  if (!SUBMISSION_FILE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      message: SUBMISSION_FILE_ERROR_MESSAGES.SUB_018,
    };
  }
  return { ok: true };
}

export function validateSubmissionContent(
  submissionType: SubmissionType,
  input: SubmissionFormInput,
  policy: SubmissionUploadLimit,
): SubmissionFormErrors {
  switch (submissionType) {
    case 'FILE': {
      const result = validateSubmissionFile(input.file, policy);
      return result.ok ? {} : { file: result.message };
    }
    case 'TEXT':
      return input.text.trim() ? {} : { text: '제출 내용을 입력해 주세요.' };
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}
