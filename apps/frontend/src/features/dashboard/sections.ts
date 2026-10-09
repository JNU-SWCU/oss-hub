import type {
  DashboardItem,
  DashboardMilestone,
  DashboardSubmissionStatus,
} from './types';

export type ActiveDashboardItem = DashboardItem & {
  readonly nextMilestone: DashboardMilestone;
};

interface DashboardSections {
  readonly active: readonly ActiveDashboardItem[];
  readonly done: readonly DashboardItem[];
  readonly applying: readonly DashboardItem[];
  readonly primaryApplicationId: string | null;
}

function isActive(item: DashboardItem): item is ActiveDashboardItem {
  return item.applicationStatus === 'APPROVED' && item.nextMilestone !== null;
}

function needsSubmission(status: DashboardSubmissionStatus): boolean {
  return status === 'NOT_SUBMITTED' || status === 'CHANGES_REQUESTED';
}

export function splitDashboardItems(
  items: readonly DashboardItem[],
): DashboardSections {
  const active = items
    .filter(isActive)
    .sort(
      (left, right) =>
        Date.parse(left.nextMilestone.dueAt) -
        Date.parse(right.nextMilestone.dueAt),
    );

  return {
    active,
    done: items.filter(
      (item) =>
        item.applicationStatus === 'APPROVED' && item.nextMilestone === null,
    ),
    applying: items.filter((item) => item.applicationStatus !== 'APPROVED'),
    primaryApplicationId:
      active.find((item) =>
        needsSubmission(item.nextMilestone.submissionStatus),
      )?.applicationId ?? null,
  };
}

export function submissionActionLabel(
  status: DashboardSubmissionStatus,
): string {
  if (status === 'NOT_SUBMITTED') return '서류 내기';
  if (status === 'CHANGES_REQUESTED') return '다시 내기';
  return '제출 현황';
}
