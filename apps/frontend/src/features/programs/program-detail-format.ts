import type { ProgramDetail, SubmissionStatus, SubmissionType } from './types';

const CATEGORY_LABELS = {
  BASIC: '기본 프로그램',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} as const satisfies Readonly<Record<ProgramDetail['category'], string>>;

const SUBMISSION_LABELS = {
  NOT_SUBMITTED: '제출 전',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 필요',
  REJECTED: '최종 반려',
} as const satisfies Readonly<Record<SubmissionStatus, string>>;

const TYPE_LABELS = {
  FILE: '파일',
  TEXT: '텍스트',
  REPOSITORY_RELEASE: '저장소 릴리스',
} as const satisfies Readonly<Record<SubmissionType, string>>;

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function categoryLabel(category: ProgramDetail['category']): string {
  return CATEGORY_LABELS[category];
}

export function submissionLabel(status: SubmissionStatus): string {
  return SUBMISSION_LABELS[status];
}

export function submissionTypeLabel(type: SubmissionType): string {
  return TYPE_LABELS[type];
}

export function formatSeoulDate(value: string): string {
  return DATE_FORMAT.format(new Date(value));
}
