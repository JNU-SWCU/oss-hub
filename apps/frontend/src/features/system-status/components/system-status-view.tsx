'use client';

import {
  Activity,
  AlertCircle,
  Database,
  GitBranch,
  PlayCircle,
  RotateCcw,
} from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  CollectionHealth,
  CurrentRunStatus,
  SystemStatus,
  SystemStatusSafeReason,
  SystemStatusViewState,
  TriggerNotice,
} from '../types';

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

/**
 * 운영자에게 보이는 사유 문구.
 * 각 문구는 "지금 무슨 상태인가" 다음에 반드시 "그래서 무엇을 보면 되는가"를 붙인다 —
 * 상태만 적힌 경고는 운영자를 화면 앞에 세워 두고 다음 행동을 알려 주지 않는다.
 * 내부 식별자·토큰·저장소 이름은 넣지 않는다(이 화면의 안전 사유 계약).
 */
/** 빈 상태 화면은 제목이 이미 같은 문장을 말하므로 다음 행동만 따로 쓴다. */
const NO_TRACKED_REPOSITORIES_ACTION =
  '사업단 GitHub 조직에 수집 연동 앱이 설치되어 있는지, 조직에 저장소가 등록되어 있는지 확인해 주세요.';

const SAFE_REASON_COPY = {
  NO_TRACKED_REPOSITORIES: `아직 추적 중인 저장소가 없습니다. ${NO_TRACKED_REPOSITORIES_ACTION}`,
  UPSTREAM_RATE_LIMITED:
    '재시도 대기 중인 stream이 있습니다. GitHub 호출 한도가 풀리면 다음 수집 주기에 자동으로 다시 시도하므로 지금 손댈 것은 없습니다. 아래 ‘가장 오래된 재시도 대기’ 시각이 하루 넘게 그대로면 사업단 관리자에게 알려 주세요.',
  RUN_INCOMPLETE:
    '일부 저장소의 수집이 아직 완료되지 않았습니다. 아래 ‘Stream 진행 상황’에서 ‘부분/대기’ 수가 줄고 있는지 확인하고, 다음 수집 주기 뒤에도 그대로면 사업단 관리자에게 알려 주세요.',
  STALE_DATA:
    '최근 데이터 수집이 지연되고 있습니다. 아래 ‘데이터 기준 시각’이 얼마나 오래됐는지 먼저 확인하고, 지연이 이어지면 수집 연동 앱의 설치·권한 상태를 점검해 주세요.',
} as const satisfies Record<SystemStatusSafeReason, string>;

/**
 * 이 화면의 ‘수집 연동 앱’이 무엇인지 모르는 운영자를 위한 설명.
 * 개인이 자기 GitHub 계정에 붙이는 앱과 헷갈리면 엉뚱한 곳(개인 설정)을 뒤지게 되므로
 * 설치 주체(조직)와 읽는 범위, 확인할 위치를 함께 적는다.
 */
const COLLECTION_APP_TITLE = '수집 연동 앱(GitHub App)이란';
const COLLECTION_APP_DESCRIPTION =
  'GitHub App은 사업단 저장소의 활동을 대신 읽어 오는 수집 연동 앱입니다. 개인이 자기 GitHub 계정에 설치하는 앱이 아니라 사업단 GitHub 조직에 설치되며, 설치를 승인한 조직 저장소만 읽습니다. 수집이 비어 있거나 지연이 계속되면 조직의 Settings → GitHub Apps에서 이 앱이 설치·승인되어 있고 저장소 접근 범위에 대상 저장소가 들어 있는지 확인해 주세요.';

/** 수집이 정상이 아닐 때만 띄운다 — 평소에는 운영자가 읽어야 할 것이 아니다. */
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

/**
 * Stream 진행 상황의 4구간(완료/Backfill 중/부분·대기/재시도 대기) — 세그먼트 바와
 * 범례가 같은 순서·같은 색을 공유하도록 한 곳에 정의한다. 프로젝트 디자인 토큰만
 * 사용한다(하드코딩 색상 금지, `status-badge.tsx`와 동일한 원칙).
 */
const STREAM_SEGMENTS = [
  { key: 'ready', label: '완료(READY)', colorClass: 'bg-primary' },
  { key: 'backfilling', label: 'Backfill 중', colorClass: 'bg-primary/60' },
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

  const summary = `전체 ${total}개 stream 중 ${STREAM_SEGMENTS.map(
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
            <dt className="text-muted-foreground">이번 사이클 시작</dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.lastCycleStartedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">최근 사이클 완료</dt>
            <dd className="mt-1 font-medium">
              {formatTimestamp(status.lastCycleCompletedAt)}
            </dd>
          </div>
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
  const pct = total > 0 ? Math.round((status.readyStreamCount / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch aria-hidden="true" className="size-5" />
          Stream 진행 상황
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            완료 {status.readyStreamCount} / {total} stream ({pct}%)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            추적 저장소 {status.trackedRepositoryCount}개 × commit·PR·release
            3종 stream
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
            <dt className="text-muted-foreground">가장 오래된 완료 checkpoint</dt>
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

  const { status } = state;
  const isEmpty = status.health === 'EMPTY';
  // 이미 실행 중인 사이클에 두 번째 트리거를 보내 봐야 lease가 거절한다 — 요청을
  // 보내기 전에 막아 관리자가 실패 응답을 받고서야 알게 되는 상황을 없앤다.
  const triggerDisabled =
    isTriggering || status.currentRunStatus === 'PROCESSING';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="시스템 상태"
        description="증분 데이터 수집 상태와 최신 checkpoint 시각을 확인합니다."
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

      {/* 트리거 결과 알림 — Alert의 role="alert"가 등장 즉시 스크린 리더에 통지한다. */}
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
        <section aria-label="시스템 상태 요약">
          <CardGrid>
            <CollectionStatusCard status={status} />
            <StreamProgressCard status={status} />
            <DataFreshnessCard status={status} />
          </CardGrid>
        </section>
      )}

      {/* 정상일 때는 붙이지 않는다 — 문제가 없을 때 읽어야 할 안내가 아니다. */}
      {status.health === 'NORMAL' ? null : <CollectionAppGuide />}
    </main>
  );
}
