import type { DashboardItem, DashboardMilestone } from './types';

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

function canSubmit(milestone: DashboardMilestone, now: Date): boolean {
  if (milestone.submissionStatus === 'CHANGES_REQUESTED') return true;
  return (
    milestone.submissionStatus === 'NOT_SUBMITTED' &&
    now.getTime() <= Date.parse(milestone.dueAt)
  );
}

export function splitDashboardItems(
  items: readonly DashboardItem[],
  now: Date,
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
      active.find((item) => canSubmit(item.nextMilestone, now))
        ?.applicationId ?? null,
  };
}

export function submissionActionLabel(
  milestone: DashboardMilestone,
  now: Date,
): string {
  if (!canSubmit(milestone, now)) return '제출 현황';
  return milestone.submissionStatus === 'CHANGES_REQUESTED'
    ? '다시 내기'
    : '서류 내기';
}
