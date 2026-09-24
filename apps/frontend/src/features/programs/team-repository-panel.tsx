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
  /** 활동 카드 제목 — 학생은 「우리 팀 활동」, 교직원은 「팀 활동」. */
  readonly activityTitle: string;
  /** 저장 경로. 학생은 내 신청, 교직원은 팀 경로다. */
  readonly saveRepositoryUrl: (
    repositoryUrl: string,
  ) => Promise<RepositoryUrlState>;
  readonly lockedHint?: string;
  /** 저장 뒤 화면이 따로 다시 읽을 것이 있으면 부른다. */
  readonly onSaved?: () => void;
  /** 저장소 카드 안 URL 줄 아래에 붙는 화면 고유 내용. */
  readonly children?: ReactNode;
}

/**
 * 팀 저장소 URL 줄·활동 그래프·변경 이력 — 학생 「우리 팀」과 교직원 팀 상세가
 * 같이 쓴다(#1133). URL 줄과 그래프는 **한 조회**(`getTeamActivity`)에서 나오므로
 * 주소와 그래프가 서로 다른 저장소를 말하지 않는다.
 *
 * 프로그램·팀이 바뀌면 이전 팀의 주소·그래프·이력을 한 줄도 남기지 않는다.
 */
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
}: TeamRepositoryPanelProps) {
  const [repository, setRepository] = useState<RepositoryUrlState | null>(null);
  const [graph, setGraph] = useState<GraphState>({ kind: 'loading' });
  const [saves, setSaves] = useState(0);
  const seqRef = useRef(0);
  const titleId = useId();

  /** 늦게 온 응답이 더 새 조회·저장 결과를 덮지 않게 마지막 조회만 반영한다. */
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
      // 그려 둔 그래프는 두고, 기다리던 자리만 실패로 바꾼다.
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
      // 그래프는 새 저장소를 따라간다 — 옛 저장소의 수를 새 주소 아래 두지 않는다.
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
              {/* 펼칠 때마다, 그리고 저장할 때마다 첫 쪽부터 다시 읽는다. */}
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
