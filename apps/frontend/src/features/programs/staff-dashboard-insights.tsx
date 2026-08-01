import type { ReactElement } from 'react';
import { formatStaffActivityTime } from './staff-dashboard-format';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardApplicationCounts,
  StaffDashboardSubmissionSummary,
} from './types';

interface ApplicationsProps {
  readonly applications: StaffDashboardApplicationCounts;
}

export function StaffApplicationInsights({
  applications,
}: ApplicationsProps): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
      <Metric label="전체" value={applications.total} />
      <Metric label="승인 대기" value={applications.pendingApproval} />
      <Metric label="승인" value={applications.approved} />
      <Metric label="반려" value={applications.rejected} />
    </dl>
  );
}

interface ActivityProps {
  readonly activity: StaffDashboardActivitySummary;
}

export function StaffActivityInsights({
  activity,
}: ActivityProps): ReactElement {
  const activityCount =
    activity.commits + activity.pullRequests + activity.releases;
  let activityStatus: string | null = null;
  if (activity.repositories === 0) {
    activityStatus = '연결된 저장소가 없습니다.';
  } else if (activity.dataAsOf === null) {
    activityStatus = '수집된 활동 기준 시점이 없습니다.';
  } else if (activityCount === 0) {
    activityStatus = '수집은 완료됐지만 활동이 없습니다.';
  }
  return (
    <div className="grid gap-2">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
        <Metric label="저장소" value={activity.repositories} />
        <Metric label="커밋" value={activity.commits} />
        <Metric label="PR" value={activity.pullRequests} />
        <Metric label="릴리스" value={activity.releases} />
      </dl>
      {activityStatus ? (
        <p className="text-xs text-muted-foreground">{activityStatus}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {activity.lastActivityAt
          ? `최근 활동 ${formatStaffActivityTime(activity.lastActivityAt)}`
          : '최근 활동 없음'}
      </p>
      {activity.dataAsOf ? (
        <p className="text-xs text-muted-foreground">
          데이터 기준 {formatStaffActivityTime(activity.dataAsOf)}
        </p>
      ) : null}
    </div>
  );
}

interface SubmissionsProps {
  readonly submissions: StaffDashboardSubmissionSummary;
}

export function StaffSubmissionInsights({
  submissions,
}: SubmissionsProps): ReactElement {
  const reviewedOrWaiting =
    submissions.submitted +
    submissions.approved +
    submissions.changesRequested +
    submissions.rejected;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        마일스톤 {submissions.milestones} · 제출 대상 {submissions.total}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
        <Metric label="미제출" value={submissions.notSubmitted} />
        <Metric label="검토 대기" value={submissions.submitted} />
        <Metric label="승인" value={submissions.approved} />
        <Metric label="보완 요청" value={submissions.changesRequested} />
        <Metric label="반려" value={submissions.rejected} />
      </dl>
      {submissions.milestones === 0 ? (
        <p className="text-xs text-muted-foreground">
          등록된 마일스톤이 없습니다.
        </p>
      ) : null}
      {reviewedOrWaiting === 0 ? (
        <p className="text-xs text-muted-foreground">제출된 항목이 없습니다.</p>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): ReactElement {
  return (
    <div>
      <dt className="inline text-muted-foreground">{label} </dt>
      <dd className="inline font-medium">{value}</dd>
    </div>
  );
}
