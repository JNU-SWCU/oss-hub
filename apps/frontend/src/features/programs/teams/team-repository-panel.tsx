'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useId, useMemo, type ReactNode } from 'react';
import { FailureState } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import type { RepositoryUrlState } from './repository-url-dto';
import { RepositoryUrlEditor } from './repository-url-editor';
import { RepositoryUrlHistory } from './repository-url-history';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '../catalog/queries';
import { useTeamActivityQuery } from './queries';
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

  readonly activityExtra?: ReactNode;
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
  activityExtra,
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

  if (repository === null) {
    return graph.kind === 'failed' ? (
      <FailureState title="저장소를 불러오지 못했습니다" onRetry={refresh} />
    ) : (
      <Skeleton label="저장소 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-28 rounded-card" />
        <SkeletonBlock className="h-80 rounded-card" />
      </Skeleton>
    );
  }

  return (
    <>
      <RepositoryUrlEditor
        repository={repository}
        save={save}
        reload={load}
        lockedHint={lockedHint}
      >
        {children}
      </RepositoryUrlEditor>
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
            <FailureState
              title="활동을 불러오지 못했습니다"
              onRetry={refresh}
            />
          ) : (
            <TeamActivityGraph
              activity={graph.activity}
              label={activityTitle}
            />
          )}
          {graph.kind === 'ready' && graph.activity.lastSuccessAt !== null
            ? activityExtra
            : null}
          <Collapsible className="border-t border-border pt-2">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group w-full justify-between"
              >
                저장소 URL 변경 이력
                <ChevronDown
                  aria-hidden="true"
                  className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <RepositoryUrlHistory programId={programId} teamId={teamId} />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </>
  );
}
