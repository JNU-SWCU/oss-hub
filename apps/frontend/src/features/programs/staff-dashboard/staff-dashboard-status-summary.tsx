import type { ReactElement } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STAFF_RECRUITMENT_BADGES } from './staff-dashboard-format';
import type { StaffDashboardStatusSummary } from './staff-dashboard-status';

export function StaffDashboardStatusSummary({
  summary,
}: {
  readonly summary: StaffDashboardStatusSummary;
}): ReactElement {
  return (
    <section
      aria-label="전체 프로그램 모집 상태"
      className="grid gap-4 sm:grid-cols-3"
    >
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.recruiting.label}
        count={summary.recruiting}
      />
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.in_progress.label}
        count={summary.inProgress}
      />
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.ended.label}
        count={summary.ended}
      />
    </section>
  );
}

function StatusCount({
  label,
  count,
}: {
  readonly label: string;
  readonly count: number;
}): ReactElement {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{count}개</p>
      </CardContent>
    </Card>
  );
}
