import type { ProblemDetail } from '@/lib/api-client';
import type {
  SubmissionFileUploadCache,
  SubmissionFormInput,
} from './submission-form';
import type {
  ChecklistSubmission,
  ChecklistSubmissionStatus,
  CreatedResubmission,
  ResubmissionContent,
  SubmissionChecklist,
  SubmissionChecklistItem,
  SubmissionType,
} from './types';

export type ChecklistItemStatus = 'NOT_SUBMITTED' | ChecklistSubmissionStatus;

export function isRevisionNeeded(
  submission: ChecklistSubmission | null,
): boolean {
  return (
    submission?.canResubmit === true ||
    submission?.status === 'CHANGES_REQUESTED'
  );
}

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

export function milestoneDeadline(
  dueAt: string,
  now: Date,
): { readonly dDay: number; readonly label: string } {
  const dDay = calendarDayNumber(new Date(dueAt)) - calendarDayNumber(now);
  const label = dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
  return { dDay, label };
}

export function hasMilestoneDeadlinePassed(dueAt: string, now: Date): boolean {
  const due = new Date(dueAt).getTime();
  return Number.isFinite(due) && now.getTime() > due;
}

export function sortChecklistItems(
  items: readonly SubmissionChecklistItem[],
): readonly SubmissionChecklistItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
  );
}

export interface ChecklistSubmittedCount {
  readonly total: number;
  readonly submitted: number;
  readonly revisionNeeded: number;
}

export function checklistSubmittedCount(
  items: readonly SubmissionChecklistItem[],
): ChecklistSubmittedCount {
  return {
    total: items.length,
    submitted: items.filter((item) => item.submission !== null).length,
    revisionNeeded: items.filter(
      (item) => item.submission?.status === 'CHANGES_REQUESTED',
    ).length,
  };
}

export type ResubmissionFailure =
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'field';
      readonly field: 'file' | 'text';
      readonly message: string;
    }
  | { readonly kind: 'alert'; readonly message: string };

export type ResubmissionPhase = 'uploading' | 'creating';

export interface SubmitResubmissionRevisionInput {
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly submission: {
    readonly id: string;
    readonly currentRevision: number;
  };
  readonly submissionType: SubmissionType;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly cache: SubmissionFileUploadCache;
  readonly uploadSubmissionFile: (
    applicationId: string,
    milestoneId: string,
    file: File,
    context: { readonly submissionId: string; readonly baseRevision: number },
  ) => Promise<{ readonly fileId: string }>;
  readonly createResubmission: (input: {
    readonly submissionId: string;
    readonly baseRevision: number;
    readonly content: ResubmissionContent;
    readonly comment: string;
  }) => Promise<CreatedResubmission>;
  readonly onPhaseChange?: (phase: ResubmissionPhase) => void;
}

export function resubmissionFailure(
  problem: ProblemDetail,
  submissionType: SubmissionType,
): ResubmissionFailure {
  if (problem.status === 409) return { kind: 'stale' };
  if (problem.code === 'SUB_011') {
    return {
      kind: 'field',
      field: submissionType === 'TEXT' ? 'text' : 'file',
      message: problem.detail,
    };
  }
  return { kind: 'alert', message: problem.detail };
}

export function resubmissionContent(
  submissionType: SubmissionType,
  input: SubmissionFormInput,
  fileId?: string,
): ResubmissionContent | null {
  switch (submissionType) {
    case 'TEXT':
      return { type: 'TEXT', text: input.text.trim() };
    case 'FILE':
      return fileId ? { type: 'FILE', fileId } : null;
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}

export async function submitResubmissionRevision({
  applicationId,
  milestoneId,
  submission,
  submissionType,
  input,
  comment,
  cache,
  uploadSubmissionFile,
  createResubmission,
  onPhaseChange,
}: SubmitResubmissionRevisionInput): Promise<CreatedResubmission | null> {
  const baseRevision = submission.currentRevision;
  let content = resubmissionContent(submissionType, input);
  if (submissionType === 'FILE') {
    const file = input.file;
    if (!file) return null;
    onPhaseChange?.('uploading');
    const fileId = await cache.resolve(file, () =>
      uploadSubmissionFile(applicationId, milestoneId, file, {
        submissionId: submission.id,
        baseRevision,
      }),
    );
    content = resubmissionContent('FILE', input, fileId);
  }
  if (!content) return null;

  onPhaseChange?.('creating');
  return createResubmission({
    submissionId: submission.id,
    baseRevision,
    content,
    comment,
  });
}

export function applyResubmission(
  checklist: SubmissionChecklist,
  milestoneId: string,
  result: CreatedResubmission,
  now: Date,
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
              canResubmit: !hasMilestoneDeadlinePassed(item.dueAt, now),
            },
          }
        : item,
    ),
  };
}
