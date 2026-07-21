'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getProgramActivity } from '../api';
import { formatSeoulDate } from '../program-detail-format';
import type { ProgramActivity } from '../types';

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
        className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
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
          <div className="flex items-center justify-between gap-3 text-sm">
            <strong>{activity.label}</strong>
            <span>{activity.commitCount} commits</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent"
              style={{
                width: `${Math.min(100, Math.max(4, activity.commitCount * 5))}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {activity.lastActivityAt
              ? `최근 활동 ${formatSeoulDate(activity.lastActivityAt)}`
              : '수집된 커밋 활동이 없습니다'}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ActivityGraphPanel({
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

  return (
    <Card aria-labelledby="activity-title">
      <CardHeader>
        <CardTitle id="activity-title">활동 그래프</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityPanelBody state={state} onRetry={() => void load()} />
      </CardContent>
    </Card>
  );
}
