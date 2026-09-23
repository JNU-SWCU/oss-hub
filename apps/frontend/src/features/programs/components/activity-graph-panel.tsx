'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, FailureState } from '@/components';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { getProgramActivity } from '../api';
import { formatSeoulDate } from '../program-detail-format';
import type { ProgramActivity, ViewerRole } from '../types';

export type ActivityState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly activities: readonly ProgramActivity[] };

const metrics = [
  { key: 'commitCount', label: '커밋', color: 'bg-primary' },
  { key: 'pullRequestCount', label: 'PR', color: 'bg-accent' },
  { key: 'releaseCount', label: '릴리스', color: 'bg-foreground' },
] as const;

export function ActivityPanelBody({
  state,
  onRetry,
  compareTeams = true,
}: {
  readonly state: ActivityState;
  readonly onRetry: () => void;
  readonly compareTeams?: boolean;
}) {
  if (state.kind === 'loading')
    return (
      <Skeleton label="활동 불러오는 중">
        <SkeletonBlock className="h-24 rounded-card" />
      </Skeleton>
    );
  if (state.kind === 'failed') {
    return (
      <FailureState
        title="활동을 불러오지 못했습니다"
        description="프로그램 정보는 정상적으로 표시되고 있습니다."
        onRetry={onRetry}
      />
    );
  }
  if (state.activities.length === 0) {
    return (
      <EmptyState
        className="break-keep"
        title="표시할 팀이 없습니다"
        description={
          compareTeams
            ? '참여 팀이 생기면 활동을 비교할 수 있습니다.'
            : '우리 팀의 활동이 집계되면 표시됩니다.'
        }
      />
    );
  }
  const maxima = metrics.map(({ key }) =>
    Math.max(0, ...state.activities.map((activity) => activity[key])),
  );
  return (
    <div className="grid gap-6">
      {compareTeams ? (
        <p
          id="activity-scale"
          className="break-keep text-small text-muted-foreground"
        >
          표시된 팀 중 같은 지표의 최댓값이 100%입니다.
        </p>
      ) : null}
      <ul className="grid gap-6">
        {state.activities.map((activity) => (
          <li
            className="grid min-w-0 gap-3 border-b pb-6 last:border-0 last:pb-0"
            key={activity.applicationId}
          >
            <strong className="break-words">{activity.label}</strong>
            {activity.collectionStatus === 'NOT_CONNECTED' && (
              <p className="text-small text-muted-foreground">
                저장소가 연결되지 않았습니다.
              </p>
            )}
            {activity.collectionStatus === 'FAILED' && (
              <Alert variant="destructive" role="note">
                <AlertTitle>활동 수집에 실패했습니다</AlertTitle>
                <AlertDescription>
                  {activity.dataAsOf ? '마지막으로 수집된 값입니다. ' : ''}잠시
                  후 다시 확인해 주세요.
                </AlertDescription>
              </Alert>
            )}
            {activity.collectionStatus === 'EMPTY' && (
              <p className="text-small text-muted-foreground">
                아직 수집된 활동이 없습니다.
              </p>
            )}
            {activity.commitCount +
              activity.pullRequestCount +
              activity.releaseCount >
              0 && (
              <dl className="grid gap-3 text-small">
                {metrics.map(({ key, label, color }, index) => (
                  <div className="grid gap-1" key={key}>
                    <div className="flex justify-between gap-3">
                      <dt>{label}</dt>
                      <dd className="tabular-nums">{activity[key]}</dd>
                    </div>
                    {compareTeams ? (
                      <div
                        className="h-2 overflow-hidden rounded-full bg-muted"
                        role="meter"
                        aria-label={`${activity.label} ${label}`}
                        aria-describedby="activity-scale"
                        aria-valuemin={0}
                        aria-valuemax={Math.max(1, maxima[index] ?? 0)}
                        aria-valuenow={activity[key]}
                        aria-valuetext={`${activity[key]}건, 같은 지표의 최댓값 ${maxima[index] ?? 0}건`}
                      >
                        <div
                          className={`h-full rounded-full ${color}`}
                          style={{
                            width: `${maxima[index] ? (activity[key] / maxima[index]) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </dl>
            )}
            {activity.hasIncompleteContributions && (
              <Alert role="note">
                <AlertTitle>기여도 수집이 온전하지 않습니다</AlertTitle>
                <AlertDescription className="break-keep">
                  팀원별 합계와 팀 합계가 다릅니다. 수집 당시 팀 명단을 확인하지
                  못했을 수 있습니다.
                </AlertDescription>
              </Alert>
            )}
            {activity.members.length > 0 && (
              <details className="min-w-0">
                <summary className="cursor-pointer rounded-sm py-2 text-small focus-visible:outline-2 focus-visible:outline-ring">
                  팀원별 기여 ({activity.members.length}명)
                </summary>
                <ul
                  className="grid gap-4 pt-3"
                  aria-label={`${activity.label} 팀원별 기여`}
                >
                  {activity.members.map((member) => (
                    <li className="grid min-w-0 gap-2" key={member.githubLogin}>
                      <span className="break-all font-medium">
                        @{member.githubLogin}
                      </span>
                      <dl className="grid grid-cols-3 gap-2 text-small">
                        {metrics.map(({ key, label }) => (
                          <div key={key}>
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="tabular-nums">{member[key]}</dd>
                          </div>
                        ))}
                      </dl>
                      {member.commitCount +
                        member.pullRequestCount +
                        member.releaseCount ===
                        0 && (
                        <p className="text-small text-muted-foreground">
                          아직 기여 없음
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {activity.collectionStatus !== 'NOT_CONNECTED' && (
              <div className="grid gap-1 text-small text-muted-foreground">
                {activity.lastActivityAt && (
                  <p>최근 활동 {formatSeoulDate(activity.lastActivityAt)}</p>
                )}
                <p>
                  {activity.dataAsOf
                    ? `데이터 기준 ${formatSeoulDate(activity.dataAsOf)}`
                    : '아직 게시된 활동 데이터가 없습니다'}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 실제 활동 집계를 읽어 그리는 본문. 카드도 제목도 두지 않는다 — 이미 제목이
 * 있는 자리(「우리 팀 활동」)에 놓이면 같은 말을 두 번 하는 머리가 되기 때문에,
 * 테두리와 제목은 그것이 필요한 호출부(`ActivityGraphPanel`)만 씌운다.
 */
export function ActivityGraphContent({
  programId,
  applicationId,
}: {
  readonly programId: string;
  readonly applicationId?: string;
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

  const visibleState =
    state.kind === 'ready' && applicationId !== undefined
      ? {
          kind: 'ready' as const,
          activities: state.activities.filter(
            (activity) => activity.applicationId === applicationId,
          ),
        }
      : state;
  return (
    <ActivityPanelBody
      state={visibleState}
      onRetry={() => void load()}
      compareTeams={applicationId === undefined}
    />
  );
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
