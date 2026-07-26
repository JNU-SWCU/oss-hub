'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FolderGit2, RotateCcw, UserRound } from 'lucide-react';
import {
  CardGrid,
  DetailPanelLayout,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  PublicProfileNotFoundError,
  loadPublicProfile,
} from '../public-profile-api';
import type {
  PublicProfile,
  PublicProfileRepository,
  PublicProfileState,
} from '../public-profile-types';

type PublicProfileContentProps = {
  readonly state: PublicProfileState;
  readonly onRetry: () => void;
};

function LoadingState() {
  return (
    <main
      aria-label="공개 프로필을 불러오는 중"
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
        <AlertTitle>공개 프로필을 불러오지 못했습니다</AlertTitle>
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
        icon={<UserRound className="size-8" />}
        title="공개 프로필을 찾을 수 없습니다"
        description="존재하지 않거나 공개 프로젝트가 없는 사용자입니다."
        action={
          <Button asChild variant="outline">
            <Link href="/archive">공개 아카이브로 돌아가기</Link>
          </Button>
        }
      />
    </main>
  );
}

function RepositoryCard({
  repository,
}: {
  readonly repository: PublicProfileRepository;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {repository.programName} · {repository.modeLabel}
            </p>
            <CardTitle className="mt-1 break-words">
              {repository.displayName}
            </CardTitle>
          </div>
          <StatusBadge variant="approved">GitHub PUBLIC</StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid gap-1">
          <span className="text-muted-foreground">저장소</span>
          <code className="break-all">{repository.repositoryName}</code>
        </div>
        <div className="grid gap-1">
          <span className="text-muted-foreground">공개일</span>
          <time dateTime={repository.publishedAt}>
            {repository.publishedLabel}
          </time>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href={repository.detailUrl}>상세 보기</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProfileContent({ profile }: { readonly profile: PublicProfile }) {
  const avatar = profile.avatarUrl ? (
    // GitHub avatar CDN — next/image remotePatterns 없이 표시한다.
    // eslint-disable-next-line @next/next/no-img-element -- 외부 avatar URL
    <img
      src={profile.avatarUrl}
      alt=""
      width={48}
      height={48}
      className="size-12 rounded-full"
    />
  ) : (
    <span
      aria-hidden
      className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground"
    >
      {profile.githubNickname.slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title={profile.githubNickname}
        description="공개 프로젝트 활동"
        actions={avatar}
      />
      <DetailPanelLayout
        primary={
          <section
            aria-labelledby="public-profile-repositories"
            className="grid gap-4"
          >
            <div className="flex items-center gap-2">
              <FolderGit2 aria-hidden="true" className="size-5" />
              <h2
                id="public-profile-repositories"
                className="font-heading text-xl font-semibold"
              >
                공개 기여 활동
              </h2>
            </div>
            <CardGrid>
              {profile.repositories.map((repository) => (
                <RepositoryCard
                  key={repository.repositoryId}
                  repository={repository}
                />
              ))}
            </CardGrid>
          </section>
        }
        secondary={
          <Card>
            <CardHeader>
              <CardTitle>활동 안내</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                활동량 안내: 평가·점수·랭킹이 아닙니다
              </p>
            </CardContent>
          </Card>
        }
      />
    </main>
  );
}

export function PublicProfileContent({
  state,
  onRetry,
}: PublicProfileContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;
  if (state.kind === 'not-found') return <NotFoundState />;
  return <ProfileContent profile={state.profile} />;
}

export function PublicProfileView({ userId }: { readonly userId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PublicProfileState>({ kind: 'loading' });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadPublicProfile(userId)
      .then((profile) => {
        if (active) setState({ kind: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof PublicProfileNotFoundError
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });
    return () => {
      active = false;
    };
  }, [attempt, userId]);

  return <PublicProfileContent state={state} onRetry={retry} />;
}
