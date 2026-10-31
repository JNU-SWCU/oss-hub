'use client';

import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';
import {
  DetailPanelLayout,
  EmptyState,
  PageHeader,
  FailureState,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { ProjectNotFoundError } from '../api';
import { useProjectDetailQuery } from '../queries';
import type { ProjectDetail, ProjectDetailState } from '../types';

type ProjectDetailContentProps = {
  readonly state: ProjectDetailState;
  readonly onRetry: () => void;
};

function LoadingState() {
  return (
    <main className="mx-auto w-full max-w-6xl p-5 sm:p-8">
      <Skeleton label="공개 프로젝트를 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-24 rounded-lg" />
        <SkeletonBlock className="h-64 rounded-lg" />
      </Skeleton>
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <FailureState
        title="공개 프로젝트를 불러오지 못했습니다"
        onRetry={onRetry}
      />
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
            <Link href="/programs?status=ended">목록으로 돌아가기</Link>
          </Button>
        }
      />
    </main>
  );
}

function DetailContent({ project }: { readonly project: ProjectDetail }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title={project.displayName}
        description={project.programName}
        actions={
          <Button asChild>
            <a href={project.githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              GitHub 저장소 열기
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
                  <code className="break-all">{project.repositoryName}</code>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground">공개일</span>
                  <time dateTime={project.publishedAt}>
                    {project.publishedLabel}
                  </time>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>기여자</CardTitle>
              </CardHeader>
              <CardContent>
                {project.contributors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    등록된 기여자가 없습니다.
                  </p>
                ) : (
                  <ul className="grid gap-3">
                    {project.contributors.map((contributor) => (
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
                          Commit {contributor.commitCount} · PR{' '}
                          {contributor.pullRequestCount} · Release{' '}
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
                    {project.metrics.commitCount}
                  </strong>
                </div>
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">PR</span>
                  <strong className="text-2xl">
                    {project.metrics.pullRequestCount}
                  </strong>
                </div>
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">Release</span>
                  <strong className="text-2xl">
                    {project.metrics.releaseCount}
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

export function ProjectDetailContent({
  state,
  onRetry,
}: ProjectDetailContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;
  if (state.kind === 'not-found') return <NotFoundState />;
  return <DetailContent project={state.project} />;
}

export function ProjectDetailView({
  projectId,
}: {
  readonly projectId: string;
}) {
  const query = useProjectDetailQuery(projectId);
  const state: ProjectDetailState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? {
          kind:
            query.error instanceof ProjectNotFoundError ? 'not-found' : 'error',
        }
      : { kind: 'ready', project: query.data };

  return (
    <ProjectDetailContent state={state} onRetry={() => void query.refetch()} />
  );
}
