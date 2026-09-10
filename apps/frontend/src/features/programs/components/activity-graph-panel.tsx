'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getProgramActivity } from '../api';
import { formatSeoulDate } from '../program-detail-format';
import type { ProgramActivity, ViewerRole } from '../types';

export type ActivityState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly activities: readonly ProgramActivity[] };

export function ActivityPanelBody({
  state,
  onRetry,
}: {
  readonly state: ActivityState;
  readonly onRetry: () => void;
}) {
  if (state.kind === 'loading')
    return (
      <div
        className="h-24 animate-pulse rounded-card bg-muted motion-reduce:animate-none"
        aria-label="활동 불러오는 중"
      />
    );
  if (state.kind === 'failed') {
    return (
      <EmptyState
        title="활동을 불러오지 못했습니다"
        description="프로그램 정보는 정상적으로 표시되고 있습니다."
        action={
          <Button type="button" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (state.activities.length === 0) {
    return (
      <EmptyState
        title="아직 연결된 저장소가 없습니다"
        description="저장소가 연결되면 커밋 활동이 여기에 표시됩니다."
      />
    );
  }
  return (
    <ul className="grid gap-4">
      {state.activities.map((activity) => (
        <li className="grid gap-2" key={activity.applicationId}>
          <strong>{activity.label}</strong>
          <dl className="grid grid-cols-3 gap-3 text-small">
            <div>
              <dt className="text-muted-foreground">커밋</dt>
              <dd>{activity.commitCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">PR</dt>
              <dd>{activity.pullRequestCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">릴리스</dt>
              <dd>{activity.releaseCount}</dd>
            </div>
          </dl>
          <div className="grid gap-1 text-small text-muted-foreground">
            <p>
              {activity.lastActivityAt
                ? `최근 활동 ${formatSeoulDate(activity.lastActivityAt)}`
                : '아직 수집된 활동이 없습니다'}
            </p>
            <p>
              {activity.dataAsOf
                ? `데이터 기준 ${formatSeoulDate(activity.dataAsOf)}`
                : '아직 게시된 활동 데이터가 없습니다'}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 실제 활동 집계를 읽어 그리는 본문. 카드도 제목도 두지 않는다 — 이미 제목이
 * 있는 자리(「우리 팀 활동」)에 놓이면 같은 말을 두 번 하는 머리가 되기 때문에,
 * 테두리와 제목은 그것이 필요한 호출부(`ActivityGraphPanel`)만 씌운다.
 */
export function ActivityGraphContent({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<ActivityState>({ kind: 'loading' });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        activities: await getProgramActivity(programId),
      });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [programId]);
  useEffect(() => {
    void load();
  }, [load]);

  return <ActivityPanelBody state={state} onRetry={() => void load()} />;
}

export function ActivityGraphPanel({
  programId,
  viewerRole,
}: {
  readonly programId: string;
  readonly viewerRole: ViewerRole;
}) {
  if (viewerRole === null || viewerRole === 'PENDING') return null;
  return (
    <Card aria-labelledby="activity-title">
      <CardHeader>
        <CardTitle id="activity-title">활동 현황</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityGraphContent programId={programId} />
      </CardContent>
    </Card>
  );
}
