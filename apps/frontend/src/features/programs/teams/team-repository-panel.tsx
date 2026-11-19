'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, type ReactNode } from 'react';
import { FailureState } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { invalidateProgram } from '../catalog/queries';
import { useTeamActivityQuery } from './queries';
import type { RepositoryUrlState } from './repository-url-dto';
import { RepositoryUrlEditor } from './repository-url-editor';
import { RepositoryUrlHistoryDisclosure } from './repository-url-history';
import type { TeamActivity } from './team-activity-dto';
import { TeamActivityGraph } from './team-activity-graph';

type GraphState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly activity: TeamActivity };

export interface TeamRepositoryPanelProps {
  readonly programId: string;
  readonly teamId: string;

  readonly activityTitle: string;

  readonly saveRepositoryUrl: (
    repositoryUrl: string,
  ) => Promise<RepositoryUrlState>;
  readonly lockedHint?: string;

  readonly onSaved?: () => void;

  readonly children?: ReactNode;
  readonly renderBetween?: (activity: TeamActivity | undefined) => ReactNode;
}

export function TeamRepositoryPanel(props: TeamRepositoryPanelProps) {
  return (
    <TeamRepositoryPanelBody
      key={`${props.programId}|${props.teamId}`}
      {...props}
    />
  );
}

function TeamRepositoryPanelBody({
  programId,
  teamId,
  activityTitle,
  saveRepositoryUrl,
  lockedHint,
  onSaved,
  children,
  renderBetween,
}: TeamRepositoryPanelProps) {
  const queryClient = useQueryClient();
  const query = useTeamActivityQuery(programId, teamId);
  const activity = query.data;
  const repository = useMemo<RepositoryUrlState | null>(
    () =>
      activity === undefined
        ? null
        : {
            repositoryUrl: activity.repository?.url ?? null,
            canEditRepositoryUrl: activity.canEditRepositoryUrl,
          },
    [activity],
  );
  const graph: GraphState = query.isFetching
    ? { kind: 'loading' }
    : activity !== undefined
      ? { kind: 'ready', activity }
      : query.isError
        ? { kind: 'failed' }
        : { kind: 'loading' };
  const titleId = useId();
  const load = useCallback(async (): Promise<boolean> => {
    const result = await query.refetch({ throwOnError: true });
    return result.isSuccess;
  }, [query.refetch]);
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);

  const save = useCallback(
    async (repositoryUrl: string): Promise<RepositoryUrlState> => {
      const saved = await saveRepositoryUrl(repositoryUrl);

      void invalidateProgram(queryClient, programId);
      onSaved?.();
      return saved;
    },
    [saveRepositoryUrl, queryClient, programId, onSaved],
  );

  const repositoryContent =
    repository !== null ? (
      <RepositoryUrlEditor
        repository={repository}
        defaultBranch={activity?.repository?.defaultBranch}
        lastSuccessAt={activity?.lastSuccessAt}
        save={save}
        reload={load}
        lockedHint={lockedHint}
      >
        {children}
        <RepositoryUrlHistoryDisclosure
          programId={programId}
          teamId={teamId}
          initialCount={activity?.repositoryUrlHistoryCount}
        />
      </RepositoryUrlEditor>
    ) : graph.kind === 'failed' ? (
      <FailureState title="저장소를 불러오지 못했습니다" onRetry={refresh} />
    ) : (
      <Skeleton label="저장소 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-28 rounded-card" />
        {renderBetween === undefined ? (
          <SkeletonBlock className="h-80 rounded-card" />
        ) : null}
      </Skeleton>
    );

  if (repository === null && renderBetween === undefined) {
    return repositoryContent;
  }

  const latestActivity =
    graph.kind === 'ready' && !query.isError ? graph.activity : undefined;

  return (
    <>
      {repositoryContent}
      {renderBetween?.(latestActivity)}
      <Card size="sm" role="region" aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId} className="contents">
              {activityTitle}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {graph.kind === 'loading' ? (
            <Skeleton label="활동 불러오는 중">
              <SkeletonBlock className="h-64 rounded-card" />
            </Skeleton>
          ) : graph.kind === 'failed' ? (
            <FailureState title="활동을 불러오지 못했습니다" />
          ) : (
            <TeamActivityGraph
              activity={graph.activity}
              label={activityTitle}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
