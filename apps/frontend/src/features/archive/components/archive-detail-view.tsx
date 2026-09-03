'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, RotateCcw, Users } from 'lucide-react';
import { DetailPanelLayout, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArchiveNotFoundError, loadArchiveDetail } from '../api';
import type { ArchiveDetail, ArchiveDetailState } from '../types';

type ArchiveDetailContentProps = {
  readonly state: ArchiveDetailState;
  readonly onRetry: () => void;
};

function LoadingState() {
  return (
    <main
      aria-label="공개 프로젝트를 불러오는 중"
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
    >
      <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>공개 프로젝트를 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}

function NotFoundState() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      <EmptyState
        icon={<Users className="size-8" />}
        title="공개 프로젝트를 찾을 수 없습니다"
        description="비공개 처리되었거나 존재하지 않는 프로젝트입니다."
        action={
          <Button asChild variant="outline">
            <Link href="/archive">목록으로 돌아가기</Link>
          </Button>
        }
      />
    </main>
  );
}

function DetailContent({ archive }: { readonly archive: ArchiveDetail }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title={archive.displayName}
        description={`${archive.programName} · ${archive.modeLabel}`}
        actions={
          <Button asChild>
            <a href={archive.githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              GitHub 열기
            </a>
          </Button>
        }
      />
      <DetailPanelLayout
        primary={
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>프로젝트 정보</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                <div className="grid gap-1">
                  <span className="text-muted-foreground">저장소</span>
                  <code className="break-all">{archive.repositoryName}</code>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground">공개일</span>
                  <time dateTime={archive.publishedAt}>
                    {archive.publishedLabel}
                  </time>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>기여자</CardTitle>
              </CardHeader>
              <CardContent>
                {archive.contributors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    등록된 기여자가 없습니다.
                  </p>
                ) : (
                  <ul className="grid gap-3">
                    {archive.contributors.map((contributor) => (
                      <li
                        key={contributor.githubLogin}
                        className="flex flex-wrap items-center justify-between gap-3"
                      >
                        <a
                          href={contributor.githubProfileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 font-medium hover:underline"
                        >
                          <span
                            aria-hidden
                            className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
                          >
                            {contributor.githubLogin.slice(0, 1).toUpperCase()}
                          </span>
                          @{contributor.githubLogin}
                        </a>
                        <span className="text-xs text-muted-foreground">
                          커밋 {contributor.commitCount} · PR{' '}
                          {contributor.pullRequestCount} · 릴리스{' '}
                          {contributor.releaseCount}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        }
        secondary={
          <Card>
            <CardHeader>
              <CardTitle>누적 활동</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">Commit</span>
                  <strong className="text-2xl">
                    {archive.metrics.commitCount}
                  </strong>
                </div>
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">PR</span>
                  <strong className="text-2xl">
                    {archive.metrics.pullRequestCount}
                  </strong>
                </div>
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">Release</span>
                  <strong className="text-2xl">
                    {archive.metrics.releaseCount}
                  </strong>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                누적 활동 안내: 평가·점수·랭킹이 아닙니다
              </p>
            </CardContent>
          </Card>
        }
      />
    </main>
  );
}

export function ArchiveDetailContent({
  state,
  onRetry,
}: ArchiveDetailContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;
  if (state.kind === 'not-found') return <NotFoundState />;
  return <DetailContent archive={state.archive} />;
}

export function ArchiveDetailView({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ArchiveDetailState>({ kind: 'loading' });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadArchiveDetail(repositoryId)
      .then((archive) => {
        if (active) setState({ kind: 'ready', archive });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof ArchiveNotFoundError
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });
    return () => {
      active = false;
    };
  }, [attempt, repositoryId]);

  return <ArchiveDetailContent state={state} onRetry={retry} />;
}
