import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
} from '@/lib/submission-upload-policy';
import type { SubmissionType } from './types';

export const SUBMISSION_FILE_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export const SUBMISSION_FILE_ACCEPT =
  '.pdf,.hwp,.jpg,.jpeg,.png,.zip,application/pdf,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/x-hwp-v5,image/jpeg,image/png,application/zip';

const SUBMISSION_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.hwp',
  '.jpg',
  '.jpeg',
  '.png',
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

// SUB_017(INVALID_FILE_UPLOAD)은 원인이 하나가 아니다. 백엔드 발생 조건 전부:
//   - 업로드 요청의 파일 부분이 없거나 읽을 수 없음
//     (submission-files.service.ts: file === undefined || !Buffer.isBuffer)
//   - 신청 ID·마일스톤 ID·제출 ID가 빈 문자열이거나 공백이 섞인 형태 (requiredOpaqueId)
//   - 재제출 회차 값이 양의 정수가 아님 (requiredPositiveInteger)
//   - multipart 파싱 한도 초과 (submissions.controller.ts: LIMIT_FIELD_* / LIMIT_*_COUNT)
// 어느 것도 "만료"가 아니고, 서버 응답만으로는 이 중 무엇인지 특정할 수 없다.
// 그러니 원인을 단정하지 말고 사용자가 실제로 할 수 있는 행동만 제시한다.
const SUBMISSION_FILE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  SUB_017:
    '제출 요청이 서버에 온전히 전달되지 않았습니다. 파일을 다시 선택해 제출해 보고, 그래도 안 되면 프로그램 상세에서 해당 마일스톤의 제출 화면을 다시 열어 주세요.',
  SUB_018: 'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.',
  // 문구는 `@/lib/submission-upload-policy`가 소유하고 backend SUB_019와 같은 문장이다.
  // 화면에서 걸러지든 서버가 413으로 거절하든 학생은 같은 숫자를 읽어야 한다(#1106),
  // 그리고 그 숫자의 표기도 한 가지여야 한다 — 「5MiB」와 「5MB」가 섞여 있었다(#1107).
  SUB_019: SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
  SUB_020: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  SUB_021:
    '프로그램 종료일이 설정되지 않아 파일을 제출할 수 없습니다. 담당 교직원에게 확인해 주세요.',
};

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

export function getSubmissionFileErrorMessage(code: string): string | null {
  return SUBMISSION_FILE_ERROR_MESSAGES[code] ?? null;
}

/** 유형별 제출 입력의 DOM id. `SubmissionInput`이 실제로 쓰는 값과 같아야 한다. */
export const SUBMISSION_FIELD_IDS = {
  FILE: 'submission-file',
  TEXT: 'submission-text',
} as const satisfies Readonly<Record<SubmissionType, string>>;

/**
 * 검증에 걸려 제출이 멈췄을 때 그 입력으로 초점을 옮긴다. 제출 창은 세로로 스크롤되고
 * 버튼은 바닥에 붙어 있어, 초점을 옮기지 않으면 한참 위에 뜬 오류 문구가 화면 밖에
 * 남는다 — 사용자에게는 버튼을 눌러도 아무 일이 없는 것과 같다.
 */
export function focusSubmissionField(submissionType: SubmissionType): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(SUBMISSION_FIELD_IDS[submissionType]);
  if (target instanceof HTMLElement) target.focus();
}

export function validateSubmissionFile(
  file: File | null,
): SubmissionFileValidation {
  if (file === null) {
    return { ok: false, message: '제출할 파일을 선택해 주세요.' };
  }
  if (file.size > SUBMISSION_FILE_MAX_BYTES) {
    return {
      ok: false,
      message: SUBMISSION_FILE_ERROR_MESSAGES.SUB_019,
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
): SubmissionFormErrors {
  switch (submissionType) {
    case 'FILE': {
      const result = validateSubmissionFile(input.file);
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
