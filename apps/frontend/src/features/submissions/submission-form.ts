import type { SubmissionType } from './types';

export interface SubmissionFormInput {
  readonly text: string;
  readonly releaseUrl: string;
}

export interface SubmissionFormErrors {
  readonly text?: string;
  readonly releaseUrl?: string;
}

const STALE_SUBMISSION_FORM_CODES = new Set(['SUB_005', 'SUB_006']);

export function isStaleSubmissionFormErrorCode(code: string): boolean {
  return STALE_SUBMISSION_FORM_CODES.has(code);
}

export function validateSubmissionContent(
  submissionType: SubmissionType,
  input: SubmissionFormInput,
): SubmissionFormErrors {
  switch (submissionType) {
    case 'FILE':
      return {};
    case 'TEXT':
      return input.text.trim() ? {} : { text: '제출 내용을 입력해 주세요.' };
    case 'REPOSITORY_RELEASE': {
      if (!URL.canParse(input.releaseUrl)) {
        return {
          releaseUrl: '태그 또는 릴리스의 전체 URL을 입력해 주세요.',
        };
      }
      const protocol = new URL(input.releaseUrl).protocol;
      return protocol === 'http:' || protocol === 'https:'
        ? {}
        : {
            releaseUrl: '태그 또는 릴리스의 전체 URL을 입력해 주세요.',
          };
    }
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}
