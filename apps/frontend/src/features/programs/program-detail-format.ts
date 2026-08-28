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

export function isPastDue(value: string, now: number = Date.now()): boolean {
  const dueAt = new Date(value).getTime();
  return Number.isFinite(dueAt) && now > dueAt;
}

const SEOUL_PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function seoulParts(value: string): Record<string, string> {
  const parts = SEOUL_PARTS_FORMAT.formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 팩트 바 기간 표기 — "2026.09.01" */
export function formatSeoulDateOnly(value: string): string {
  const { year, month, day } = seoulParts(value);
  return `${year}.${month}.${day}`;
}

/** 제출 타임스탬프 표기 — "09.16 14:22" */
export function formatSeoulShortDateTime(value: string): string {
  const { month, day, hour, minute } = seoulParts(value);
  return `${month}.${day} ${hour}:${minute}`;
}
