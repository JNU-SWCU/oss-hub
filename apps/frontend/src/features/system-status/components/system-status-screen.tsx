'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { fetchSystemStatus, triggerCollection } from '../api';
import type { SystemStatusViewState, TriggerNotice } from '../types';
import { SystemStatusView } from './system-status-view';

const QUIESCE_TRIGGER_MESSAGE =
  '저장소 전환 작업이 진행 중이라 지금은 수집을 시작할 수 없습니다. 전환이 끝난 뒤 다시 시도해 주세요.';
const GENERIC_TRIGGER_ERROR_MESSAGE =
  '수집을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function SystemStatusScreen() {
  const [state, setState] = useState<SystemStatusViewState>({
    kind: 'loading',
  });
  const requestSequence = useRef(0);
  const triggerInFlight = useRef(false);
  const mounted = useRef(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerNotice, setTriggerNotice] = useState<TriggerNotice | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState((previous) =>
      previous.kind === 'success'
        ? { ...previous, freshness: 'refreshing' }
        : { kind: 'loading' },
    );
    try {
      const data = await fetchSystemStatus();
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState({ kind: 'success', freshness: 'current', ...data });
    } catch {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState((previous) =>
        previous.kind === 'success'
          ? { ...previous, freshness: 'stale' }
          : { kind: 'error' },
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [refresh]);

  const handleTrigger = useCallback(async () => {
    if (triggerInFlight.current) return;
    triggerInFlight.current = true;
    setIsTriggering(true);
    setTriggerNotice(null);
    try {
      await triggerCollection();
      if (!mounted.current) return;
      setTriggerNotice({
        kind: 'success',
        message: '수집 요청을 접수했습니다.',
      });
      await refresh();
    } catch (error: unknown) {
      if (!mounted.current) return;
      const message =
        error instanceof ApiError && error.problem.code === 'COL_008'
          ? QUIESCE_TRIGGER_MESSAGE
          : GENERIC_TRIGGER_ERROR_MESSAGE;
      setTriggerNotice({ kind: 'error', message });
    } finally {
      triggerInFlight.current = false;
      if (mounted.current) setIsTriggering(false);
    }
  }, [refresh]);

  return (
    <SystemStatusView
      state={state}
      onRetry={() => void refresh()}
      onTrigger={() => void handleTrigger()}
      isTriggering={isTriggering}
      triggerNotice={triggerNotice}
    />
  );
}
