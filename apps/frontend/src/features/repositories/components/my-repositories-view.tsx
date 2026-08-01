import { AlertCircle, ExternalLink, FolderGit2, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import {
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  SectionHeading,
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
    <PageBody aria-label="내 저장소를 불러오는 중">
      <div className="h-20 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <CardGrid>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="animate-pulse rounded-card bg-muted motion-reduce:animate-none"
          />
        ))}
      </CardGrid>
    </PageBody>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <PageBody className="max-w-3xl">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>내 저장소를 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </PageBody>
  );
}

function RepositoryCard({ item }: { readonly item: MyRepositoryItem }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-small text-muted-foreground">
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
          <span className="text-small font-semibold text-muted-foreground">
            저장소
          </span>
          <code className="break-all text-small text-foreground">
            {item.repositoryName ?? '생성 전'}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {item.visibility !== null ? (
            <StatusBadge
              variant={item.visibility === 'PUBLIC' ? 'approved' : 'closed'}
            >
              {item.visibility}
            </StatusBadge>
          ) : null}
          {item.invitationLabel ? (
            <span className="text-small text-muted-foreground">
              {item.invitationLabel}
            </span>
          ) : null}
        </div>
      </CardContent>
      {item.canOpenGithub && item.githubUrl ? (
        <CardFooter className="flex flex-wrap gap-3">
          <Button asChild size="sm" variant="outline">
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
    <PageBody>
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
          action={
            <Button asChild>
              <Link href="/programs">프로그램 둘러보기</Link>
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="repository-list-title" className="grid gap-6">
          <SectionHeading
            id="repository-list-title"
            title="저장소 현황"
            meta={`${state.repositories.items.length}개`}
          />
          <CardGrid>
            {state.repositories.items.map((item) => (
              <RepositoryCard key={item.applicationId} item={item} />
            ))}
          </CardGrid>
        </section>
      )}
    </PageBody>
  );
}
