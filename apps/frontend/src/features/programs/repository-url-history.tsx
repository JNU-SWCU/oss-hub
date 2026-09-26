'use client';

import { useCallback, useEffect, useState } from 'react';
import { FailureState } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { formatSeoulDate } from './program-detail-format';
import {
  getRepositoryHistory,
  type RepositoryHistoryPage,
} from './team-activity-api';

/**
 * 저장소 URL 변경 이력 — 누가·언제·무엇에서 무엇으로. 펼칠 때 붙어 첫 쪽을 읽고,
 * 더 보기는 앞 쪽의 커서로 이어 붙인다. 부모가 프로그램·팀·저장 차수로 key를 주므로
 * 다른 팀의 이력이나 저장 전의 이력을 들고 있지 않는다.
 */
export function RepositoryUrlHistory({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string;
}) {
  const [history, setHistory] = useState<RepositoryHistoryPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  const loadFirst = useCallback(() => {
    setFailed(false);
    getRepositoryHistory(programId, teamId).then(setHistory, () =>
      setFailed(true),
    );
  }, [programId, teamId]);
  useEffect(loadFirst, [loadFirst]);

  async function loadMore() {
    if (history?.nextCursor == null) return;
    setBusy(true);
    setMoreFailed(false);
    try {
      const next = await getRepositoryHistory(
        programId,
        teamId,
        history.nextCursor,
      );
      setHistory((current) => ({
        items: [...(current?.items ?? []), ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch {
      setMoreFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <FailureState
        title="저장소 URL 변경 이력을 불러오지 못했습니다"
        onRetry={loadFirst}
      />
    );
  }
  if (history === null) {
    return (
      <Skeleton label="저장소 URL 변경 이력 불러오는 중">
        <SkeletonBlock className="h-20 rounded-control" />
      </Skeleton>
    );
  }
  return (
    <section
      className="grid gap-3 break-keep [overflow-wrap:anywhere]"
      aria-label="저장소 URL 변경 이력"
    >
      {history.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          저장소 URL 변경 이력이 없습니다.
        </p>
      ) : (
        <ol className="grid gap-3">
          {history.items.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 rounded-control border border-border p-3 text-sm"
            >
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="break-all">@{item.actorGithubLogin}</span>
                <time className="whitespace-nowrap" dateTime={item.occurredAt}>
                  {formatSeoulDate(item.occurredAt)}
                </time>
              </p>
              <dl className="grid gap-2">
                <div>
                  <dt className="text-muted-foreground">변경 전</dt>
                  <dd className="break-all">
                    {item.previousRepositoryUrl ?? '연결된 저장소 없음'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">변경 후</dt>
                  <dd className="break-all">{item.newRepositoryUrl}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      {moreFailed ? (
        <Alert variant="destructive">
          <AlertTitle>이력 조회 실패</AlertTitle>
          <AlertDescription>
            표시된 이력은 유지되었습니다. 더 보기를 눌러 다시 시도해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}
      {history.nextCursor ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void loadMore()}
          >
            {busy ? '불러오는 중…' : '변경 이력 더 보기'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
