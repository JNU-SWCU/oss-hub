import type { ProblemDetail } from '@/lib/api-client';
import type { SubmissionFormInput } from './submission-form';
import type {
  ChecklistSubmissionStatus,
  CreatedResubmission,
  CreateSubmissionContent,
  SubmissionChecklist,
  SubmissionChecklistItem,
  SubmissionType,
} from './types';

/** 체크리스트 행의 표시 상태 — 미제출(submission=null)을 포함한 5종. */
export type ChecklistItemStatus = 'NOT_SUBMITTED' | ChecklistSubmissionStatus;

/**
 * features/programs 화면(program-detail-format.ts)과 동일한 한국어 라벨.
 * feature 간 직접 import가 금지라 문자열을 그대로 맞춘다 — 라벨을 바꿀 때는
 * 두 곳을 함께 바꾼다.
 */
export const CHECKLIST_STATUS_LABELS = {
  NOT_SUBMITTED: '제출 전',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 필요',
  REJECTED: '최종 반려',
} as const satisfies Readonly<Record<ChecklistItemStatus, string>>;

/** features/programs milestone-row와 동일한 StatusBadge variant 매핑. */
export const CHECKLIST_STATUS_VARIANTS = {
  NOT_SUBMITTED: 'pending',
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'rejected',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<ChecklistItemStatus, 'pending' | 'approved' | 'rejected'>
>;

export function checklistItemStatus(
  item: SubmissionChecklistItem,
): ChecklistItemStatus {
  return item.submission?.status ?? 'NOT_SUBMITTED';
}

const SEOUL_TIME_ZONE = 'Asia/Seoul';

function calendarDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * D-day는 dueAt으로 계산하는 표시 상태이며 Submission 상태 enum에 저장하지
 * 않는다. 규칙은 backend program-deadline.ts와 동일: Asia/Seoul 달력일 차이,
 * 라벨은 '마감 지남'/'오늘 마감'/'D-n'.
 */
export function milestoneDeadline(
  dueAt: string,
  now: Date,
): { readonly dDay: number; readonly label: string } {
  const dDay = calendarDayNumber(new Date(dueAt)) - calendarDayNumber(now);
  const label = dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
  return { dDay, label };
}

/** features/programs milestone-row와 동일한 마감 배지 variant 규칙. */
export function deadlineVariant(
  dDay: number,
): 'rejected' | 'pending' | 'recruiting' {
  return dDay < 0 ? 'rejected' : dDay === 0 ? 'pending' : 'recruiting';
}

/** 서버가 dueAt ASC를 보장하지만 epoch 수치 기준으로 방어 정렬한다. */
export function sortChecklistItems(
  items: readonly SubmissionChecklistItem[],
): readonly SubmissionChecklistItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
  );
}

export type ResubmissionFailure =
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'field';
      readonly field: 'text' | 'releaseUrl';
      readonly message: string;
    }
  | { readonly kind: 'alert'; readonly message: string };

/**
 * 재제출 실패 분기. 409는 코드와 무관하게 stale로 본다 — RESUBMISSION_NOT_ALLOWED
 * (SUB_013)와 STALE_SUBMISSION_REVISION(SUB_014) 모두 "내가 보던 체크리스트가
 * 낡았다"는 뜻이라 최신 상태를 다시 불러온다. field 오류 코드는 #115와 동일.
 */
export function resubmissionFailure(
  problem: ProblemDetail,
  submissionType: SubmissionType,
): ResubmissionFailure {
  if (problem.status === 409) return { kind: 'stale' };
  if (problem.code === 'SUB_009') {
    return { kind: 'field', field: 'releaseUrl', message: problem.detail };
  }
  if (problem.code === 'SUB_011') {
    return {
      kind: 'field',
      field: submissionType === 'TEXT' ? 'text' : 'releaseUrl',
      message: problem.detail,
    };
  }
  return { kind: 'alert', message: problem.detail };
}

/** 유형별 재제출 content — FILE은 업로드 미지원(fail-closed)이라 null. */
export function resubmissionContent(
  submissionType: SubmissionType,
  input: SubmissionFormInput,
): CreateSubmissionContent | null {
  switch (submissionType) {
    case 'TEXT':
      return { type: 'TEXT', text: input.text.trim() };
    case 'REPOSITORY_RELEASE':
      return {
        type: 'REPOSITORY_RELEASE',
        releaseUrl: input.releaseUrl.trim(),
      };
    case 'FILE':
      return null;
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}

/** 재제출 성공(201)을 체크리스트에 반영 — 해당 행만 SUBMITTED로 갱신한다. */
export function applyResubmission(
  checklist: SubmissionChecklist,
  milestoneId: string,
  result: CreatedResubmission,
): SubmissionChecklist {
  return {
    ...checklist,
    items: checklist.items.map((item) =>
      item.milestoneId === milestoneId && item.submission
        ? {
            ...item,
            submission: {
              ...item.submission,
              status: result.status,
              currentRevision: result.revision,
              canResubmit: false,
            },
          }
        : item,
    ),
  };
}
