'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { retryProvisioning, triggerCollection } from '../api';
import { useSystemStatusQuery } from '../queries';
import type {
  ActionNotice,
  ProvisioningFailedTeam,
  SystemStatusViewState,
} from '../types';
import { SystemStatusView } from './system-status-view';

const TRIGGER_ERROR_MESSAGE =
  '수집을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const SUCCESS_NOTICE_MS = 4_000;
const NOT_RETRYABLE_CODE = 'APP_037';
const STALE_ROW_STATUSES = [404, 409];

interface RetryOutcome {
  readonly notice: ActionNotice;
  readonly resync: boolean;
}

async function requestRetry(
  team: ProvisioningFailedTeam,
): Promise<RetryOutcome> {
  try {
    await retryProvisioning(team.teamId);
    return {
      notice: {
        kind: 'success',
        message: `${team.teamName}의 저장소 발급을 다시 요청했습니다.`,
      },
      resync: true,
    };
  } catch (error) {
    const problem = error instanceof ApiError ? error.problem : null;
    return {
      notice: {
        kind: 'error',
        message:
          problem?.code === NOT_RETRYABLE_CODE
            ? `${team.teamName}의 저장소 발급은 이미 다시 시도했거나 끝났습니다.`
            : `${team.teamName}의 저장소 발급을 다시 시도하지 못했습니다. 잠시 후 다시 시도하세요.`,
      },
      resync: problem !== null && STALE_ROW_STATUSES.includes(problem.status),
    };
  }
}

export function SystemStatusScreen() {
  const [staleRepositoryPage, setStaleRepositoryPage] = useState(1);
  const query = useSystemStatusQuery(staleRepositoryPage);
  const { refetch } = query;
  const state: SystemStatusViewState =
    query.data !== undefined
      ? {
          kind: 'success',
          freshness: query.isFetching
            ? 'refreshing'
            : query.isError
              ? 'stale'
              : 'current',
          status: query.data,
        }
      : query.isError
        ? { kind: 'error' }
        : { kind: 'loading' };
  const triggerInFlight = useRef(false);
  const retryInFlight = useRef(new Set<string>());
  const mounted = useRef(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [retryingTeamIds, setRetryingTeamIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timeout = window.setTimeout(() => setNotice(null), SUCCESS_NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const handleTrigger = useCallback(async () => {
    if (triggerInFlight.current) return;
    triggerInFlight.current = true;
    setIsTriggering(true);
    setNotice(null);
    try {
      await triggerCollection();
      if (!mounted.current) return;
      setNotice({ kind: 'success', message: '수집 요청을 접수했습니다.' });
      await refetch();
    } catch {
      if (!mounted.current) return;
      setNotice({ kind: 'error', message: TRIGGER_ERROR_MESSAGE });
    } finally {
      triggerInFlight.current = false;
      if (mounted.current) setIsTriggering(false);
    }
  }, [refetch]);

  const handleRetry = useCallback(
    async (team: ProvisioningFailedTeam) => {
      const inFlight = retryInFlight.current;
      if (inFlight.has(team.teamId)) return;
      inFlight.add(team.teamId);
      setRetryingTeamIds([...inFlight]);
      setNotice(null);
      try {
        const outcome = await requestRetry(team);
        if (!mounted.current) return;
        setNotice(outcome.notice);
        if (outcome.resync) await refetch();
      } finally {
        inFlight.delete(team.teamId);
        if (mounted.current) setRetryingTeamIds([...inFlight]);
      }
    },
    [refetch],
  );

  return (
    <SystemStatusView
      state={state}
      onReload={() => void refetch()}
      onTrigger={() => void handleTrigger()}
      isTriggering={isTriggering}
      onRetryProvisioning={(team) => void handleRetry(team)}
      retryingTeamIds={retryingTeamIds}
      notice={notice}
      staleRepositoryPager={{
        page: staleRepositoryPage,
        isLoading: query.isPlaceholderData,
        onPageChange: setStaleRepositoryPage,
      }}
    />
  );
}
