'use client';

import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FailureState } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import type { RepositoryUrlState } from './repository-url-api';
import { RepositoryUrlEditor } from './repository-url-editor';
import { RepositoryUrlHistory } from './repository-url-history';
import { getTeamActivity, type TeamActivity } from './team-activity-api';
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
  const [repository, setRepository] = useState<RepositoryUrlState | null>(null);
  const [graph, setGraph] = useState<GraphState>({ kind: 'loading' });
  const [saves, setSaves] = useState(0);
  const seqRef = useRef(0);
  const titleId = useId();

  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++seqRef.current;
    try {
      const activity = await getTeamActivity(programId, teamId);
      if (seq !== seqRef.current) return false;
      setRepository({
        repositoryUrl: activity.repository?.url ?? null,
        canEditRepositoryUrl: activity.canEditRepositoryUrl,
      });
      setGraph({ kind: 'ready', activity });
      return true;
    } catch (error: unknown) {
      if (seq === seqRef.current) {
        setGraph((current) =>
          current.kind === 'loading' ? { kind: 'failed' } : current,
        );
      }
      throw error;
    }
  }, [programId, teamId]);

  const refresh = useCallback(() => {
    setGraph({ kind: 'loading' });
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const save = useCallback(
    async (repositoryUrl: string): Promise<RepositoryUrlState> => {
      const saved = await saveRepositoryUrl(repositoryUrl);

      refresh();
      setSaves((count) => count + 1);
      onSaved?.();
      return saved;
    },
    [saveRepositoryUrl, refresh, onSaved],
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
              <RepositoryUrlHistory
                key={saves}
                programId={programId}
                teamId={teamId}
              />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </>
  );
}
