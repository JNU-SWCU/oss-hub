import type { ReactElement } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STAFF_RECRUITMENT_BADGES } from './staff-dashboard-format';
import type { StaffDashboardStatusSummary } from './staff-dashboard-status';

/**
 * 모집 상태 요약 카드.
 *
 * 카드는 셋이다 — 모집중 → 진행중 → 종료. 「내림」은 넷째 카드로 세우지 않고
 * 종료 카드의 부가 줄로 붙인다. 내림은 별도 상태가 아니라 종료의 부분집합이고
 * (내린 프로그램은 언제나 종료로 판정된다), 카드를 넷으로 늘리면 합이 맞지 않는
 * 것처럼 읽히기 때문이다. 그래도 따로 세는 이유는 예정대로 끝난 것과 누군가
 * 판단해서 접은 것의 후속 조치가 다르기 때문이다.
 *
 * 숫자는 검색·필터 이전의 전체 카탈로그 기준이다(`staff-dashboard-page-model.ts`).
 */
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
        note={`그중 내림 ${summary.archived}개`}
      />
    </section>
  );
}

function StatusCount({
  label,
  count,
  note,
}: {
  readonly label: string;
  readonly count: number;
  readonly note?: string;
}): ReactElement {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className="text-2xl font-semibold tabular-nums">{count}개</p>
        {note === undefined ? null : (
          <p className="text-xs text-muted-foreground">{note}</p>
        )}
      </CardContent>
    </Card>
  );
}
