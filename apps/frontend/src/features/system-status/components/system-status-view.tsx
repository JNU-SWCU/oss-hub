'use client';

import { Activity, AlertCircle, Database, PlayCircle } from 'lucide-react';
import {
  CardGrid,
  EmptyState,
  PageHeader,
  StatusBadge,
  FailureState,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { formatLastSuccess, formatRelativeTime } from '../format-relative-time';
import type {
  CollectionHealth,
  CurrentRunStatus,
  SystemStatus,
  SystemStatusSafeReason,
  SystemStatusViewState,
  TriggerNotice,
} from '../types';
import { CollectionRepositoriesTable } from './collection-repositories-table';
import { ExternalCollectionSection } from './external-collection-section';

interface SystemStatusViewProps {
  readonly state: SystemStatusViewState;
  readonly onRetry: () => void;
  readonly onTrigger: () => void;
  readonly isTriggering: boolean;
  readonly triggerNotice: TriggerNotice | null;
}

const HEALTH = {
  EMPTY: { label: '추적 대상 없음', variant: 'closed' },
  NORMAL: { label: '정상', variant: 'approved' },
  DELAYED: { label: '지연', variant: 'pending' },
} as const satisfies Record<
  CollectionHealth,
  { label: string; variant: 'approved' | 'pending' | 'closed' }
>;

const RUN_STATUS = {
  IDLE: { label: '대기 중', variant: 'closed' },
  PROCESSING: { label: '수집 중', variant: 'recruiting' },
} as const satisfies Record<
  CurrentRunStatus,
  { label: string; variant: 'closed' | 'recruiting' }
>;

const NO_TRACKED_REPOSITORIES_ACTION =
  '사업단 GitHub 조직에 수집 연동 앱이 설치되어 있는지, 조직에 저장소가 등록되어 있는지 확인해 주세요.';

const SAFE_REASON_COPY = {
  NO_TRACKED_REPOSITORIES: `아직 추적 중인 저장소가 없습니다. ${NO_TRACKED_REPOSITORIES_ACTION}`,
  STALE_DATA:
    '마지막 수집 성공이 2시간보다 오래된 저장소가 있습니다. 아래 ‘수집 대상 상세’에서 지연된 저장소를 확인하고, 다음 수집 주기 뒤에도 그대로면 수집 연동 앱의 설치·권한 상태를 점검해 주세요.',
} as const satisfies Record<SystemStatusSafeReason, string>;

const COLLECTION_APP_TITLE = '수집 앱 설치·권한 확인';
const COLLECTION_APP_DESCRIPTION =
  '사업단 GitHub 조직의 Settings → GitHub Apps에서 수집 앱 설치와 대상 저장소의 접근 권한을 확인해 주세요. 이 앱은 개인 계정이 아닌 조직에 설치하며, 접근을 승인한 저장소의 활동만 읽습니다.';

function CollectionAppGuide() {
  return (
    <Alert>
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{COLLECTION_APP_TITLE}</AlertTitle>
      <AlertDescription>{COLLECTION_APP_DESCRIPTION}</AlertDescription>
    </Alert>
  );
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string | null) {
  return value ? DATE_TIME_FORMAT.format(new Date(value)) : '기록 없음';
}

function LoadingState() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8">
      <Skeleton label="시스템 상태를 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-20 rounded-lg" />
        <CardGrid>
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-44 rounded-lg" />
          ))}
        </CardGrid>
      </Skeleton>
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <FailureState
        title="시스템 상태를 불러오지 못했습니다"
        onRetry={onRetry}
      />
    </main>
  );
}

function CollectionStatusCard({ status }: { readonly status: SystemStatus }) {
  const health = HEALTH[status.health];
  const run = RUN_STATUS[status.currentRunStatus];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-5" />
            수집 상태
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge variant={health.variant}>{health.label}</StatusBadge>
            {status.currentRunStatus === 'PROCESSING' ? (
              <StatusBadge
                variant={run.variant}
                className="before:animate-pulse motion-reduce:before:animate-none"
              >
                {run.label}
              </StatusBadge>
            ) : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {status.safeReason
            ? SAFE_REASON_COPY[status.safeReason]
            : '데이터 수집이 정상적으로 운영되고 있습니다.'}
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">추적 저장소</dt>
            <dd className="mt-1 font-medium">
              {status.trackedRepositoryCount}개
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">지연 저장소</dt>
            <dd className="mt-1 font-medium">
              {status.staleRepositoryCount}개
            </dd>
          </div>
          {status.nextCycleAt ? (
            <div>
              <dt className="text-muted-foreground">다음 주기 예상</dt>
              <dd className="mt-1 font-medium">
                {formatRelativeTime(status.nextCycleAt, new Date())} (
                {formatTimestamp(status.nextCycleAt)})
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function DataFreshnessCard({ status }: { readonly status: SystemStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database aria-hidden="true" className="size-5" />
          데이터 최신성
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">마지막 수집 성공</dt>
            <dd className="mt-1 font-medium">
              {formatLastSuccess(status.lastSuccessAt)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function SystemStatusView({
  state,
  onRetry,
  onTrigger,
  isTriggering,
  triggerNotice,
}: SystemStatusViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { status, collectionRepositories, externalCollection } = state;
  const isEmpty = status.health === 'EMPTY';

  const triggerDisabled =
    isTriggering || status.currentRunStatus === 'PROCESSING';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 break-keep p-5 sm:p-8">
      <PageHeader
        title="시스템 상태"
        description="저장소 활동의 수집 상태와 데이터 기준 시각을 확인합니다."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={triggerDisabled}
            onClick={onTrigger}
          >
            <PlayCircle aria-hidden="true" />
            {isTriggering ? '실행 요청 중…' : '지금 수집 실행'}
          </Button>
        }
      />

      {triggerNotice ? (
        <Alert
          variant={triggerNotice.kind === 'error' ? 'destructive' : 'default'}
        >
          <AlertTitle>
            {triggerNotice.kind === 'error'
              ? '수집을 시작하지 못했습니다'
              : '수집 요청을 보냈습니다'}
          </AlertTitle>
          <AlertDescription>{triggerNotice.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.freshness === 'stale' ? (
        <Alert variant="destructive">
          <AlertTitle>최신 상태를 불러오지 못했습니다</AlertTitle>
          <AlertDescription>
            <p>마지막으로 확인한 상태를 표시합니다. 다시 불러와 주세요.</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              상태 다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.freshness === 'refreshing' ? (
        <p role="status">최신 상태를 불러오는 중입니다.</p>
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon={<Database className="size-8" />}
          title="아직 추적 중인 저장소가 없습니다"
          description={NO_TRACKED_REPOSITORIES_ACTION}
        />
      ) : (
        <>
          <section aria-label="시스템 상태 요약">
            <CardGrid className="[grid-template-columns:repeat(auto-fit,minmax(min(20rem,100%),1fr))]">
              <CollectionStatusCard status={status} />
              <DataFreshnessCard status={status} />
            </CardGrid>
          </section>
          <CollectionRepositoriesTable repositories={collectionRepositories} />
        </>
      )}

      <ExternalCollectionSection status={externalCollection} />

      {status.health === 'NORMAL' ? null : <CollectionAppGuide />}
    </main>
  );
}
