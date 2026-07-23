import type {
  ApplicationMode,
  ChecklistSubmission,
  MilestoneChecklistResponse,
  MilestoneTimeline,
  SubmittedStatus,
  SubmissionType,
  TimelineStatus,
} from './types';

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
  const days = Math.round(
    (seoulDayUtcTime(new Date(dueAt)) - seoulDayUtcTime(now)) / MS_PER_DAY,
  );
  if (days === 0) return 'D-Day';
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

function statusLabel(status: TimelineStatus): string {
  return status === 'NOT_SUBMITTED' ? '미제출' : status;
}

export function parseMilestoneTimelineResponse(
  value: unknown,
  programId: string,
  now: Date = new Date(),
): MilestoneTimeline {
  const response = parseResponse(value);
  return {
    applicationId: response.applicationId,
    applicationMode: response.applicationMode,
    items: [...response.items]
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .map((item) => {
        const status = item.submission?.status ?? 'NOT_SUBMITTED';
        return {
          ...item,
          dueLabel: DATE_FORMAT.format(new Date(item.dueAt)),
          dDayLabel: dDayLabel(item.dueAt, now),
          submissionGuide: SUBMISSION_GUIDES[item.submissionType],
          status,
          statusLabel: statusLabel(status),
          submitHref: `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(item.milestoneId)}/submit`,
        };
      }),
  };
}
