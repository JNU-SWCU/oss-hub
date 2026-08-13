import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { formatStaffActivityTime } from './staff-dashboard-format';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardApplicationCounts,
  StaffDashboardSubmissionSummary,
} from './types';

type MetricTone = 'pending' | 'rejected';

interface ApplicationsProps {
  readonly applications: StaffDashboardApplicationCounts;
}

export function StaffApplicationInsights({
  applications,
}: ApplicationsProps): ReactElement {
  return (
    <dl className="grid gap-1">
      <Metric label="전체" value={applications.total} />
      <Metric
        label="승인 대기"
        value={applications.pendingApproval}
        tone="pending"
      />
      <Metric label="승인" value={applications.approved} />
      <Metric label="반려" value={applications.rejected} tone="rejected" />
    </dl>
  );
}

interface ActivityProps {
  readonly activity: StaffDashboardActivitySummary;
}

export function StaffActivityInsights({
  activity,
}: ActivityProps): ReactElement {
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1">
        <Metric label="저장소" value={activity.repositories} />
        <Metric label="커밋" value={activity.commits} />
        <Metric label="PR" value={activity.pullRequests} />
        <Metric label="릴리스" value={activity.releases} />
      </dl>
      <p className="text-xs text-muted-foreground">
        {activityCaption(activity)}
      </p>
    </div>
  );
}

interface SubmissionsProps {
  readonly submissions: StaffDashboardSubmissionSummary;
}

export function StaffSubmissionInsights({
  submissions,
}: SubmissionsProps): ReactElement {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        {submissions.milestones === 0
          ? '마일스톤 없음'
          : `마일스톤 ${submissions.milestones} · 대상 ${submissions.total}`}
      </p>
      <dl className="grid gap-1">
        <Metric
          label="미제출"
          value={submissions.notSubmitted}
          tone="pending"
        />
        <Metric
          label="검토 대기"
          value={submissions.submitted}
          tone="pending"
        />
        <Metric label="승인" value={submissions.approved} />
        <Metric
          label="보완 요청"
          value={submissions.changesRequested}
          tone="pending"
        />
        <Metric label="반려" value={submissions.rejected} tone="rejected" />
      </dl>
    </div>
  );
}

function activityCaption(activity: StaffDashboardActivitySummary): string {
  const activityCount =
    activity.commits + activity.pullRequests + activity.releases;
  if (activity.repositories === 0) {
    return '저장소 없음';
  }
  if (activity.dataAsOf === null) {
    return '수집 전';
  }
  if (activityCount === 0) {
    return '활동 없음';
  }
  if (activity.lastActivityAt) {
    return `최근 활동 ${formatStaffActivityTime(activity.lastActivityAt)}`;
  }
  return '최근 활동 없음';
}

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: MetricTone;
}): ReactElement {
  const emphasize = value > 0 ? tone : undefined;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          value === 0 && 'text-muted-foreground',
          emphasize === 'pending' && 'text-status-pending-fg',
          emphasize === 'rejected' && 'text-status-rejected-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
