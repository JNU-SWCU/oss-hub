'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  getRepositoryHistory,
  type StaffRepositoryEvidence,
} from './staff-repository-evidence';
import type { StaffProgramTeamMember } from './types';

const STATUS_LABEL = {
  NOT_COLLECTED: '아직 수집하지 않았습니다.',
  COLLECTED: '수집된 활동입니다.',
  ERROR: '최근 수집에 실패했습니다. 마지막으로 수집된 활동을 표시합니다.',
} as const;

export function StaffRepositoryEvidenceView({
  evidence,
  members,
  programId,
  teamId,
}: {
  readonly evidence: StaffRepositoryEvidence;
  readonly members: readonly StaffProgramTeamMember[];
  readonly programId: string;
  readonly teamId: string;
}) {
  const [history, setHistory] = useState(evidence.repositoryUrlHistory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const activity = evidence.repositoryContributions;
  async function loadMore() {
    if (history.nextCursor === null) return;
    setBusy(true);
    setError(false);
    try {
      const next = await getRepositoryHistory(
        programId,
        teamId,
        history.nextCursor,
      );
      setHistory((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6 break-keep [overflow-wrap:anywhere]">
      <section className="grid gap-3" aria-label="현재 저장소 활동">
        <h3 className="rounded-control bg-primary px-4 py-3 font-semibold text-primary-foreground">
          현재 저장소 활동
        </h3>
        {activity === null ? (
          <p className="text-sm text-muted-foreground">
            활동을 표시할 저장소가 없습니다.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {activity.window.from} ~ {activity.window.to} · 한국 시간 기준
            </p>
            <p className="text-sm">{STATUS_LABEL[activity.collectionStatus]}</p>
            {activity.lastSuccessAt ? (
              <p className="text-sm text-muted-foreground">
                마지막 수집:{' '}
                {new Date(activity.lastSuccessAt).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </p>
            ) : null}
            <ul className="grid gap-3" aria-label="팀원별 활동">
              {activity.members.map((member) => (
                <li
                  key={member.userId}
                  className="grid gap-1 rounded-control border border-border p-3"
                >
                  <strong className="break-all text-sm">
                    @
                    {members.find((person) => person.userId === member.userId)
                      ?.nickname ?? member.githubId}
                  </strong>
                  {member.hasObservations ? (
                    <p className="text-sm">
                      커밋 {member.commitCount} · PR {member.pullRequestCount} ·
                      릴리스 {member.releaseCount}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      수집된 활동이 없습니다.
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <h4 className="text-sm font-semibold">웹 참여자와 연결되지 않음</h4>
            {activity.unmatchedContributors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                연결되지 않은 기여자가 없습니다.
              </p>
            ) : (
              <ul className="grid gap-2">
                {activity.unmatchedContributors.map((person) => (
                  <li key={person.githubId} className="break-all text-sm">
                    GitHub ID {person.githubId} · 커밋 {person.commitCount} · PR{' '}
                    {person.pullRequestCount} · 릴리스 {person.releaseCount}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="grid gap-3" aria-label="저장소 URL 변경 이력">
        <h3 className="rounded-control bg-primary px-4 py-3 font-semibold text-primary-foreground">
          저장소 URL 변경 이력
        </h3>
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
                  <time
                    className="whitespace-nowrap"
                    dateTime={item.occurredAt}
                  >
                    {new Date(item.occurredAt).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                    })}
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
                  <div>
                    <dt className="text-muted-foreground">변경 사유</dt>
                    <dd className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                      {item.reason}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
        {error ? (
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
    </div>
  );
}
