'use client';

import { PlayCircle } from 'lucide-react';
import { FailureState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  ActionNotice,
  ProvisioningFailedTeam,
  SystemStatusViewState,
} from '../types';
import { AreaStatusList } from './area-status-list';
import { AttentionCard } from './attention-card';

interface SystemStatusViewProps {
  readonly state: SystemStatusViewState;
  readonly onReload: () => void;
  readonly onTrigger: () => void;
  readonly isTriggering: boolean;
  readonly onRetryProvisioning: (team: ProvisioningFailedTeam) => void;
  readonly retryingTeamIds: readonly string[];
  readonly notice: ActionNotice | null;
}

const PAGE =
  'mx-auto flex w-full max-w-6xl flex-col gap-8 break-keep p-5 sm:p-8';

function LoadingState() {
  return (
    <main className={PAGE}>
      <Skeleton label="시스템 상태를 불러오는 중" className="grid gap-8">
        <SkeletonBlock className="h-11 w-48 rounded-card" />
        <SkeletonBlock className="h-44 rounded-card" />
        <SkeletonBlock className="h-64 rounded-card" />
      </Skeleton>
    </main>
  );
}

function ErrorState({ onReload }: { readonly onReload: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <FailureState
        title="시스템 상태를 불러오지 못했습니다"
        onRetry={onReload}
      />
    </main>
  );
}

const TOAST = 'pointer-events-auto w-fit max-w-full shadow-md';

function ActionToast({ notice }: { readonly notice: ActionNotice }) {
  return (
    <div
      className={cn(
        'pointer-events-none sticky bottom-above-tabs z-10',
        'flex justify-center pb-4',
      )}
    >
      {notice.kind === 'error' ? (
        <Alert variant="destructive" className={cn(TOAST, 'py-4')}>
          <AlertTitle>{notice.message}</AlertTitle>
        </Alert>
      ) : (
        <p
          role="status"
          className={cn(
            TOAST,
            'rounded-card border border-status-approved-bg bg-status-approved-bg',
            'px-6 py-4 text-small font-semibold text-status-approved-fg',
          )}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}

export function SystemStatusView({
  state,
  onReload,
  onTrigger,
  isTriggering,
  onRetryProvisioning,
  retryingTeamIds,
  notice,
}: SystemStatusViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onReload={onReload} />;

  const { status } = state;
  const triggerDisabled =
    isTriggering || status.collection.currentRunStatus === 'PROCESSING';

  return (
    <main className={PAGE}>
      <PageHeader
        title="시스템 상태"
        actions={
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={triggerDisabled}
            onClick={onTrigger}
          >
            <PlayCircle aria-hidden="true" />
            {isTriggering ? '실행 요청 중…' : '지금 수집 실행'}
          </Button>
        }
      />

      {state.freshness === 'stale' ? (
        <Alert variant="destructive">
          <AlertTitle>최신 상태를 불러오지 못했습니다</AlertTitle>
          <AlertDescription>
            <p>마지막으로 확인한 상태를 표시합니다. 다시 불러와 주세요.</p>
            <Button type="button" variant="outline" onClick={onReload}>
              상태 다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.freshness === 'refreshing' ? (
        <p role="status" className="sr-only">
          최신 상태를 불러오는 중입니다.
        </p>
      ) : null}
      <AttentionCard
        anomalies={status.anomalies}
        failedTeams={status.provisioning.failedTeams}
        failedTeamsHasMore={status.provisioning.failedTeamsHasMore}
        staleRepositories={status.collectionRepositories.filter(
          (repository) => repository.stale,
        )}
        retryingTeamIds={retryingTeamIds}
        onRetry={onRetryProvisioning}
      />
      <AreaStatusList status={status} />
      {notice ? <ActionToast notice={notice} /> : null}
    </main>
  );
}
