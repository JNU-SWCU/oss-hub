import {
  Activity,
  AlertCircle,
  Clock3,
  Database,
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
  NORMAL: { label: '정상', variant: 'approved' },
  DELAYED: { label: '지연', variant: 'pending' },
  FAILED: { label: '실패', variant: 'rejected' },
} as const satisfies Record<
  CollectionHealth,
  { label: string; variant: 'approved' | 'pending' | 'rejected' }
>;

const RUN_STATUS = {
  IDLE: { label: '대기 중', variant: 'closed' },
  PENDING: { label: '실행 대기', variant: 'pending' },
  PROCESSING: { label: '수집 중', variant: 'recruiting' },
} as const satisfies Record<
  CurrentRunStatus,
  { label: string; variant: 'closed' | 'pending' | 'recruiting' }
>;

const SAFE_REASON_COPY = {
  NO_COMPLETE_DATA: '완료된 수집 이력이 없습니다.',
  INSTALLATION_INVALID: 'GitHub App 설치 상태를 확인해 주세요.',
  PERMISSION_INVALID: '수집 권한 상태를 확인해 주세요.',
  STALE_DATA: '최근 데이터 수집이 지연되고 있습니다.',
  RUN_INCOMPLETE: '최근 수집 작업이 완료되지 않았습니다.',
  UPSTREAM_RATE_LIMITED: '외부 서비스 요청 제한으로 수집이 지연되고 있습니다.',
  RUN_FAILED: '최근 수집 작업이 실패했습니다.',
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

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="시스템 상태"
        description="데이터 수집 상태와 최신 완료 시각을 확인합니다."
      />

      {status.safeReason === 'NO_COMPLETE_DATA' ? (
        <EmptyState
          icon={<Database className="size-8" />}
          title="아직 수집 이력이 없습니다"
          description={SAFE_REASON_COPY.NO_COMPLETE_DATA}
        />
      ) : null}
      {status.safeReason !== 'NO_COMPLETE_DATA' ||
      status.currentRunStatus !== 'IDLE' ? (
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
                현재 수집 작업의 실행 상태입니다.
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
                    <dt className="text-muted-foreground">마지막 완료</dt>
                    <dd className="mt-1 font-medium">
                      {formatTimestamp(status.lastCompleteSuccessAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">데이터 기준 시각</dt>
                    <dd className="mt-1 font-medium">
                      {formatTimestamp(status.dataAsOf)}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </CardGrid>
        </section>
      ) : null}
    </main>
  );
}
