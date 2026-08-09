import type { SubmissionType } from './types';

export const SUBMISSION_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const SUBMISSION_FILE_ACCEPT =
  '.pdf,.hwp,.jpg,.jpeg,.png,.zip,application/pdf,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/x-hwp-v5,image/jpeg,image/png,application/zip';

const SUBMISSION_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.hwp': [
    'application/x-hwp',
    'application/haansofthwp',
    'application/vnd.hancom.hwp',
    'application/x-hwp-v5',
    'application/octet-stream',
    '',
  ],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.zip': ['application/zip'],
};

export interface SubmissionFormInput {
  readonly file: File | null;
  readonly text: string;
  readonly releaseUrl: string;
}

export interface SubmissionFormErrors {
  readonly file?: string;
  readonly text?: string;
  readonly releaseUrl?: string;
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
  SUB_019: '파일 크기는 50 MiB를 초과할 수 없습니다.',
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
  if (!SUBMISSION_FILE_TYPES[extension]?.includes(file.type.toLowerCase())) {
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
    case 'REPOSITORY_RELEASE': {
      if (!URL.canParse(input.releaseUrl)) {
        return {
          releaseUrl: '태그 또는 릴리스의 전체 주소를 입력해 주세요.',
        };
      }
      const protocol = new URL(input.releaseUrl).protocol;
      return protocol === 'http:' || protocol === 'https:'
        ? {}
        : {
            releaseUrl: '태그 또는 릴리스의 전체 주소를 입력해 주세요.',
          };
    }
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}
