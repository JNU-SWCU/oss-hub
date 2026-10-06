'use client';

import {
  Activity,
  AlertCircle,
  Database,
  GitBranch,
  PlayCircle,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../format-relative-time';
import type {
  CollectionHealth,
  CurrentRunStatus,
  SystemStatus,
  SystemStatusSafeReason,
  SystemStatusViewState,
  TriggerNotice,
} from '../types';
import { CollectionActivityFeed } from './collection-activity-feed';
import { CollectionStreamsTable } from './collection-streams-table';
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
  PARTIAL: { label: '부분 진행', variant: 'recruiting' },
  FAILED: { label: '실패', variant: 'rejected' },
} as const satisfies Record<
  CollectionHealth,
  {
    label: string;
    variant: 'approved' | 'pending' | 'rejected' | 'closed' | 'recruiting';
  }
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
  UPSTREAM_RATE_LIMITED:
    '재시도를 기다리는 수집 항목이 있습니다. GitHub 호출 한도가 풀리면 다음 주기에 자동으로 다시 시도합니다. 아래 ‘가장 오래된 재시도 대기’ 시각이 하루 넘게 그대로면 사업단 관리자에게 알려 주세요.',
  RUN_INCOMPLETE:
    '일부 저장소의 수집이 아직 완료되지 않았습니다. 아래 ‘활동 종류별 수집’에서 ‘부분·대기’ 수를 확인해 주세요. 다음 수집 주기 뒤에도 줄지 않으면 사업단 관리자에게 알려 주세요.',
  STALE_DATA:
    '최근 데이터 수집이 지연되고 있습니다. 아래 ‘데이터 기준 시각’이 얼마나 오래됐는지 먼저 확인하고, 지연이 이어지면 수집 연동 앱의 설치·권한 상태를 점검해 주세요.',
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

const STREAM_SEGMENTS = [
  { key: 'ready', label: '완료', colorClass: 'bg-primary' },
  {
    key: 'backfilling',
    label: '과거 활동 수집 중',
    colorClass: 'bg-primary/60',
  },
  {
    key: 'partial',
    label: '부분·대기',
    colorClass: 'bg-muted-foreground/40',
  },
  {
    key: 'retryPending',
    label: '재시도 대기',
    colorClass: 'bg-destructive/70',
  },
] as const;

interface StreamProgressBarProps {
  readonly ready: number;
  readonly backfilling: number;
  readonly partial: number;
  readonly retryPending: number;
  readonly total: number;
}

function StreamProgressBar({
  ready,
  backfilling,
  partial,
  retryPending,
  total,
}: StreamProgressBarProps) {
  const counts = {
    ready,
    backfilling,
    partial,
    retryPending,
  } satisfies Record<(typeof STREAM_SEGMENTS)[number]['key'], number>;

  const summary = `전체 ${total}개 수집 항목 중 ${STREAM_SEGMENTS.map(
    (segment) => `${segment.label} ${counts[segment.key]}개`,
  ).join(', ')}입니다.`;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={summary}
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
      >
        {STREAM_SEGMENTS.filter((segment) => counts[segment.key] > 0).map(
          (segment) => (
            <div
              key={segment.key}
              className={cn('h-full', segment.colorClass)}
              style={{ width: `${(counts[segment.key] / total) * 100}%` }}
            />
          ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {STREAM_SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('size-2.5 rounded-full', segment.colorClass)}
            />
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="font-medium text-foreground">
              {counts[segment.key]}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
            <dt className="text-muted-foreground">이번 전체 순회 시작</dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.lastCycleStartedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">최근 전체 순회 완료</dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.lastCycleCompletedAt)}
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

function StreamProgressCard({ status }: { readonly status: SystemStatus }) {
  const total =
    status.readyStreamCount +
    status.backfillingStreamCount +
    status.partialStreamCount +
    status.retryPendingStreamCount;
  const pct =
    total > 0 ? Math.round((status.readyStreamCount / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch aria-hidden="true" className="size-5" />
          활동 종류별 수집
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            완료 {status.readyStreamCount} / {total}개 ({pct}%)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            저장소 {status.trackedRepositoryCount}개에서
            Commit·PR·Release·Issue를 각각 수집합니다.
          </p>
        </div>
        <StreamProgressBar
          ready={status.readyStreamCount}
          backfilling={status.backfillingStreamCount}
          partial={status.partialStreamCount}
          retryPending={status.retryPendingStreamCount}
          total={total}
        />
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
            <dt className="text-muted-foreground">데이터 기준 시각</dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.dataAsOf)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              완료 항목 중 가장 오래된 실행 시각
            </dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.oldestReadyCheckpointAt)}
            </dd>
          </div>
          {status.oldestRetryPendingAt ? (
            <div>
              <dt className="text-muted-foreground">가장 오래된 재시도 대기</dt>
              <dd className="mt-1 font-medium">
                {formatTimestamp(status.oldestRetryPendingAt)}
              </dd>
            </div>
          ) : null}
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

  const { status, collectionStreams, collectionActivity, externalCollection } =
    state;
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

      {isEmpty ? (
        <EmptyState
          icon={<Database className="size-8" />}
          title="아직 추적 중인 저장소가 없습니다"
          description={NO_TRACKED_REPOSITORIES_ACTION}
        />
      ) : (
        <>
          <section aria-label="시스템 상태 요약">
            <CardGrid>
              <CollectionStatusCard status={status} />
              <StreamProgressCard status={status} />
              <DataFreshnessCard status={status} />
            </CardGrid>
          </section>
          <CollectionStreamsTable repositories={collectionStreams} />
          <CollectionActivityFeed entries={collectionActivity} />
        </>
      )}

      <ExternalCollectionSection status={externalCollection} />

      {status.health === 'NORMAL' ? null : <CollectionAppGuide />}
    </main>
  );
}
