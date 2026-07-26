import type {
  ApplicationMode,
  ChecklistSubmission,
  MilestoneChecklistResponse,
  MilestoneTimeline,
  SubmittedStatus,
  SubmissionType,
  TimelineStatus,
} from './types';
import { isSafePathSegment } from './path-segment';

const INVALID_RESPONSE_MESSAGE =
  '마일스톤 타임라인 응답 형식이 올바르지 않습니다';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SEOUL_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SUBMISSION_GUIDES = {
  TEXT: '본문 텍스트',
  FILE: 'PDF·HWP·이미지·압축 파일',
  REPOSITORY_RELEASE: 'GitHub Release URL',
} as const satisfies Readonly<Record<SubmissionType, string>>;

// features/programs·#116 체크리스트와 동일한 한국어 라벨.
// feature 간 직접 import가 금지라 문자열을 그대로 맞춘다.
const STATUS_LABELS = {
  NOT_SUBMITTED: '제출 전',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 필요',
  REJECTED: '최종 반려',
} as const satisfies Readonly<Record<TimelineStatus, string>>;

class MilestoneTimelineResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'MilestoneTimelineResponseError';
  }
}

function invalidResponse(): never {
  throw new MilestoneTimelineResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseApplicationMode(value: unknown): ApplicationMode {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return invalidResponse();
}

function parseSubmissionType(value: unknown): SubmissionType {
  if (value === 'TEXT' || value === 'FILE' || value === 'REPOSITORY_RELEASE') {
    return value;
  }
  return invalidResponse();
}

function parseSubmittedStatus(value: unknown): SubmittedStatus {
  if (
    value === 'SUBMITTED' ||
    value === 'APPROVED' ||
    value === 'CHANGES_REQUESTED' ||
    value === 'REJECTED'
  ) {
    return value;
  }
  return invalidResponse();
}

function parseNullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  return invalidResponse();
}

function parseSubmission(value: unknown): ChecklistSubmission | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !Number.isInteger(value.currentRevision) ||
    Number(value.currentRevision) < 1 ||
    typeof value.canResubmit !== 'boolean'
  ) {
    return invalidResponse();
  }
  return {
    id: value.id,
    status: parseSubmittedStatus(value.status),
    currentRevision: Number(value.currentRevision),
    lastReviewedAt: parseNullableString(value.lastReviewedAt),
    reviewComment: parseNullableString(value.reviewComment),
    canResubmit: value.canResubmit,
  };
}

function parseResponse(value: unknown): MilestoneChecklistResponse {
  if (
    !isRecord(value) ||
    typeof value.applicationId !== 'string' ||
    !Array.isArray(value.items)
  ) {
    return invalidResponse();
  }
  return {
    applicationId: value.applicationId,
    applicationMode: parseApplicationMode(value.applicationMode),
    items: value.items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.milestoneId !== 'string' ||
        !isSafePathSegment(item.milestoneId) ||
        typeof item.name !== 'string' ||
        typeof item.dueAt !== 'string' ||
        Number.isNaN(new Date(item.dueAt).getTime())
      ) {
        return invalidResponse();
      }
      return {
        milestoneId: item.milestoneId,
        name: item.name,
        dueAt: item.dueAt,
        submissionType: parseSubmissionType(item.submissionType),
        submission: parseSubmission(item.submission),
      };
    }),
  };
}

function seoulDayUtcTime(value: Date): number {
  const parts = SEOUL_DAY_FORMAT.formatToParts(value);
  const year = parts.find((part) => part.type === 'year');
  const month = parts.find((part) => part.type === 'month');
  const day = parts.find((part) => part.type === 'day');
  if (!year || !month || !day) return invalidResponse();
  return Date.UTC(
    Number(year.value),
    Number(month.value) - 1,
    Number(day.value),
  );
}

function dDayLabel(dueAt: string, now: Date): string {
  const days = dueDayDelta(dueAt, now);
  if (days === 0) return 'D-Day';
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

function dueDayDelta(dueAt: string, now: Date): number {
  return Math.round(
    (seoulDayUtcTime(new Date(dueAt)) - seoulDayUtcTime(now)) / MS_PER_DAY,
  );
}

function statusLabel(status: TimelineStatus): string {
  return STATUS_LABELS[status];
}

type SubmitActionInput = {
  readonly programId: string;
  readonly milestoneId: string;
  readonly status: TimelineStatus;
  readonly submission: ChecklistSubmission | null;
  readonly dueDay: number;
  readonly submissionType: SubmissionType;
};

function submitAction({
  programId,
  milestoneId,
  submissionType,
  status,
  submission,
  dueDay,
}: SubmitActionInput) {
  if (submissionType === 'FILE') {
    return {
      submitHref: null,
      submitLabel: null,
      submitDisabledLabel: '파일 제출 준비 중',
    };
  }
  if (status === 'CHANGES_REQUESTED' && submission?.canResubmit) {
    return {
      submitHref: `/programs/${encodeURIComponent(programId)}/submissions?milestoneId=${encodeURIComponent(milestoneId)}`,
      submitLabel: '다시 제출',
      submitDisabledLabel: null,
    };
  }
  if (status === 'NOT_SUBMITTED' && dueDay >= 0) {
    return {
      submitHref: `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/submit`,
      submitLabel: '제출하기',
      submitDisabledLabel: null,
    };
  }
  return {
    submitHref: null,
    submitLabel: null,
    submitDisabledLabel: null,
  };
}

export function parseMilestoneTimelineResponse(
  value: unknown,
  programId: string,
  now: Date = new Date(),
): MilestoneTimeline {
  if (!isSafePathSegment(programId)) return invalidResponse();
  const response = parseResponse(value);
  return {
    applicationId: response.applicationId,
    applicationMode: response.applicationMode,
    items: [...response.items]
      .sort(
        (left, right) =>
          new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
      )
      .map((item) => {
        const status = item.submission?.status ?? 'NOT_SUBMITTED';
        const dueDay = dueDayDelta(item.dueAt, now);
        return {
          ...item,
          dueLabel: DATE_FORMAT.format(new Date(item.dueAt)),
          dDayLabel: dDayLabel(item.dueAt, now),
          submissionGuide: SUBMISSION_GUIDES[item.submissionType],
          status,
          statusLabel: statusLabel(status),
          ...submitAction({
            programId,
            milestoneId: item.milestoneId,
            submissionType: item.submissionType,
            status,
            submission: item.submission,
            dueDay,
          }),
        };
      }),
  };
}
