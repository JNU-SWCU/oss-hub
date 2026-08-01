import {
  Activity,
  AlertCircle,
  Clock3,
  Database,
  GitBranch,
  RotateCcw,
} from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CollectionHealth,
  CurrentRunStatus,
  SystemStatusSafeReason,
  SystemStatusViewState,
} from '../types';

interface SystemStatusViewProps {
  readonly state: SystemStatusViewState;
  readonly onRetry: () => void;
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

const SAFE_REASON_COPY = {
  NO_TRACKED_REPOSITORIES: '아직 추적 중인 저장소가 없습니다.',
  UPSTREAM_RATE_LIMITED: '재시도 대기 중인 stream이 있습니다.',
  RUN_INCOMPLETE: '일부 저장소의 수집이 아직 완료되지 않았습니다.',
  STALE_DATA: '최근 데이터 수집이 지연되고 있습니다.',
} as const satisfies Record<SystemStatusSafeReason, string>;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string | null) {
  return value ? DATE_TIME_FORMAT.format(new Date(value)) : '기록 없음';
}

function LoadingState() {
  return (
    <main
      aria-label="시스템 상태를 불러오는 중"
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
    >
      <div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <CardGrid aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-44 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
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
        <AlertTitle>시스템 상태를 불러오지 못했습니다</AlertTitle>
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

export function SystemStatusView({ state, onRetry }: SystemStatusViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { status } = state;
  const health = HEALTH[status.health];
  const run = RUN_STATUS[status.currentRunStatus];
  const isEmpty = status.health === 'EMPTY';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="시스템 상태"
        description="증분 데이터 수집 상태와 최신 checkpoint 시각을 확인합니다."
      />

      {isEmpty ? (
        <EmptyState
          icon={<Database className="size-8" />}
          title="아직 추적 중인 저장소가 없습니다"
          description={SAFE_REASON_COPY.NO_TRACKED_REPOSITORIES}
        />
      ) : (
        <section aria-label="시스템 상태 요약">
          <CardGrid>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Activity aria-hidden="true" className="size-5" />
                    수집 상태
                  </span>
                  <StatusBadge variant={health.variant}>
                    {health.label}
                  </StatusBadge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {status.safeReason
                  ? SAFE_REASON_COPY[status.safeReason]
                  : '데이터 수집이 정상적으로 운영되고 있습니다.'}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Clock3 aria-hidden="true" className="size-5" />
                    현재 작업
                  </span>
                  <StatusBadge variant={run.variant}>{run.label}</StatusBadge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                현재 수집 사이클의 실행 상태입니다.
              </CardContent>
            </Card>

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
                      가장 오래된 완료 checkpoint
                    </dt>
                    <dd className="mt-1 font-medium">
                      {formatTimestamp(status.oldestReadyCheckpointAt)}
                    </dd>
                  </div>
                  {status.oldestRetryPendingAt ? (
                    <div>
                      <dt className="text-muted-foreground">
                        가장 오래된 재시도 대기
                      </dt>
                      <dd className="mt-1 font-medium">
                        {formatTimestamp(status.oldestRetryPendingAt)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch aria-hidden="true" className="size-5" />
                  Stream 진행 상황
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">추적 저장소</dt>
                    <dd className="mt-1 font-medium">
                      {status.trackedRepositoryCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">완료(READY)</dt>
                    <dd className="mt-1 font-medium">
                      {status.readyStreamCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Backfill 중</dt>
                    <dd className="mt-1 font-medium">
                      {status.backfillingStreamCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">부분/대기</dt>
                    <dd className="mt-1 font-medium">
                      {status.partialStreamCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">재시도 대기</dt>
                    <dd className="mt-1 font-medium">
                      {status.retryPendingStreamCount}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </CardGrid>
        </section>
      )}
    </main>
  );
}
