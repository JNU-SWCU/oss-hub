import { AlertCircle, ExternalLink, FolderGit2, RotateCcw } from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  MyRepositoriesState,
  MyRepositoryItem,
  RepositoryProvisionStatus,
} from '../types';

type MyRepositoriesViewProps = {
  readonly state: MyRepositoriesState;
  readonly onRetry: () => void;
};

const STATUS_VARIANTS = {
  PENDING: 'pending',
  PROCESSING: 'pending',
  SUCCEEDED: 'approved',
  FAILED_RETRYABLE: 'pending',
  FAILED_FINAL: 'rejected',
} as const satisfies Readonly<
  Record<RepositoryProvisionStatus, 'pending' | 'approved' | 'rejected'>
>;

function LoadingState() {
  return (
    <main
      aria-label="내 저장소를 불러오는 중"
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
    >
      <div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <CardGrid>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-52 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ))}
      </CardGrid>
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>내 저장소를 불러오지 못했습니다</AlertTitle>
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

function RepositoryCard({ item }: { readonly item: MyRepositoryItem }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {item.programName} · {item.modeLabel}
            </p>
            <CardTitle className="mt-1 break-words">
              {item.displayName}
            </CardTitle>
          </div>
          <StatusBadge variant={STATUS_VARIANTS[item.provisionStatus]}>
            {item.provisionLabel}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            저장소
          </span>
          <code className="break-all text-sm text-foreground">
            {item.repositoryName ?? '생성 전'}
          </code>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {item.visibility !== null ? (
            <StatusBadge
              variant={item.visibility === 'PUBLIC' ? 'approved' : 'closed'}
            >
              {item.visibility}
            </StatusBadge>
          ) : null}
          {item.invitationLabel ? (
            <span className="text-muted-foreground">
              {item.invitationLabel}
            </span>
          ) : null}
        </div>
      </CardContent>
      {item.canOpenGithub && item.githubUrl ? (
        <CardFooter className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={item.githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              GitHub에서 열기
            </a>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function MyRepositoriesView({
  state,
  onRetry,
}: MyRepositoriesViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="내 저장소"
        description={
          <span className="break-keep">
            프로그램 승인 후 생성되는 GitHub 저장소와 초대 상태를 확인합니다.
          </span>
        }
      />
      {state.repositories.items.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="size-8" />}
          title="표시할 저장소가 없습니다"
          description="신청이 승인되고 저장소 생성이 시작되면 이곳에 표시됩니다."
        />
      ) : (
        <section aria-labelledby="repository-list-title" className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="repository-list-title"
              className="font-heading text-xl font-semibold"
            >
              저장소 현황
            </h2>
            <span className="text-sm text-muted-foreground">
              {state.repositories.items.length}개
            </span>
          </div>
          <CardGrid>
            {state.repositories.items.map((item) => (
              <RepositoryCard key={item.applicationId} item={item} />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
