import { ExternalLink, FolderGit2 } from 'lucide-react';
import Link from 'next/link';
import {
  CardGrid,
  ListCard,
  EmptyState,
  PageBody,
  PageHeader,
  SectionHeading,
  StatusBadge,
  FailureState,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
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
    <PageBody>
      <Skeleton
        label="내 저장소를 불러오는 중"
        className="flex flex-col gap-12"
      >
        <SkeletonBlock className="h-20 rounded-card" />
        <CardGrid>
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="rounded-card" />
          ))}
        </CardGrid>
      </Skeleton>
    </PageBody>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <PageBody className="max-w-3xl">
      <FailureState title="내 저장소를 불러오지 못했습니다" onRetry={onRetry} />
    </PageBody>
  );
}

function RepositoryCard({ item }: { readonly item: MyRepositoryItem }) {
  return (
    <ListCard
      title={item.displayName}
      subtitle={item.programName}
      badge={{
        text: item.provisionLabel,
        variant: STATUS_VARIANTS[item.provisionStatus],
      }}
      details={[
        {
          label: '저장소',
          value: (
            <code className="break-all">
              {item.repositoryName ?? '생성 전'}
            </code>
          ),
        },
      ]}
      meta={
        item.visibility !== null || item.invitationLabel ? (
          <div className="flex flex-wrap items-center gap-3">
            {item.visibility !== null ? (
              <StatusBadge
                variant={item.visibility === 'PUBLIC' ? 'approved' : 'closed'}
              >
                {item.visibility}
              </StatusBadge>
            ) : null}
            {item.invitationLabel ? <span>{item.invitationLabel}</span> : null}
          </div>
        ) : undefined
      }
      actions={
        item.canOpenGithub && item.githubUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={item.githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              GitHub에서 열기
            </a>
          </Button>
        ) : undefined
      }
    />
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
