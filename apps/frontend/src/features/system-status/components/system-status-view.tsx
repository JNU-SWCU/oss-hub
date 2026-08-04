'use client';

import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  Clock3,
  Database,
  GitBranch,
  PlayCircle,
  RotateCcw,
  Search,
} from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CollectionHealth,
  CurrentRunStatus,
  DiscoveryNotice,
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
  readonly onDiscover: (githubLogin: string) => void;
  readonly isDiscovering: boolean;
  readonly discoveryNotice: DiscoveryNotice | null;
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

interface DiscoverExternalPanelProps {
  readonly onDiscover: (githubLogin: string) => void;
  readonly isDiscovering: boolean;
  readonly discoveryNotice: DiscoveryNotice | null;
}

function DiscoverExternalPanel({
  onDiscover,
  isDiscovering,
  discoveryNotice,
}: DiscoverExternalPanelProps) {
  const [githubLogin, setGithubLogin] = useState('');
  const trimmedLogin = githubLogin.trim();
  const submitDisabled = isDiscovering || trimmedLogin.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search aria-hidden="true" className="size-5" />
          조직 밖 public 저장소 탐색
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          학생 1명의 GitHub 계정으로 조직 밖 public 저장소를 찾아 추적 목록에
          등록합니다. 여기서는 목록만 채워질 뿐, commit·PR·release 같은 실제
          수집 데이터는 채워지지 않습니다 — 다음 예약 수집이나 &quot;지금 수집
          실행&quot; 버튼을 실행해야 반영됩니다.
        </p>

        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (submitDisabled) return;
            onDiscover(trimmedLogin);
          }}
        >
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="discover-external-github-login">
              학생 GitHub 로그인
            </Label>
            <Input
              id="discover-external-github-login"
              name="githubLogin"
              placeholder="예: octocat"
              autoComplete="off"
              disabled={isDiscovering}
              value={githubLogin}
              onChange={(event) => setGithubLogin(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={submitDisabled}>
            <Search aria-hidden="true" />
            {isDiscovering ? '탐색 중…' : '지금 탐색 실행'}
          </Button>
        </form>

        {/* 탐색 결과 알림 — Alert의 role="alert"가 등장 즉시 스크린 리더에 통지한다. */}
        {discoveryNotice ? (
          <Alert
            variant={
              discoveryNotice.kind === 'error' ? 'destructive' : 'default'
            }
          >
            <AlertTitle>
              {discoveryNotice.kind === 'error'
                ? '저장소 탐색에 실패했습니다'
                : '저장소 탐색을 완료했습니다'}
            </AlertTitle>
            <AlertDescription>
              {discoveryNotice.kind === 'error' ? (
                discoveryNotice.message
              ) : (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">대상 계정</dt>
                    <dd className="mt-1 font-medium">
                      {discoveryNotice.githubLogin}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">발견</dt>
                    <dd className="mt-1 font-medium">
                      {discoveryNotice.discoveredCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">신규 등록</dt>
                    <dd className="mt-1 font-medium">
                      {discoveryNotice.upsertedCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      조직 소속으로 제외
                    </dt>
                    <dd className="mt-1 font-medium">
                      {discoveryNotice.skippedOrgProvisionedCount}
                    </dd>
                  </div>
                </dl>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
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
  onDiscover,
  isDiscovering,
  discoveryNotice,
}: SystemStatusViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { status } = state;
  const health = HEALTH[status.health];
  const run = RUN_STATUS[status.currentRunStatus];
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

      <DiscoverExternalPanel
        onDiscover={onDiscover}
        isDiscovering={isDiscovering}
        discoveryNotice={discoveryNotice}
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
