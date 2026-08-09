'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [requestKey, setRequestKey] = useState(0);
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerNotice, setTriggerNotice] = useState<TriggerNotice | null>(
    null,
  );
  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });

    fetchSystemStatus()
      .then((status) => {
        if (active) setState({ kind: 'success', status });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });

    return () => {
      active = false;
    };
  }, [requestKey]);

  // 트리거 성공 뒤에도 화면을 skeleton으로 되돌리지 않는다 — `retry`(requestKey 증가)를
  // 쓰면 방금 띄운 성공 배너까지 로딩 화면에 가려진다. 최신 상태만 조용히 다시 받는다.
  const refreshQuietly = useCallback(async () => {
    try {
      const status = await fetchSystemStatus();
      setState({ kind: 'success', status });
    } catch {
      // 트리거 자체는 성공했다 — 새로고침 실패로 전체 화면을 오류로 접지 않는다.
    }
  }, []);

  const handleTrigger = useCallback(async () => {
    setIsTriggering(true);
    setTriggerNotice(null);
    try {
      await triggerCollection();
      setTriggerNotice({
        kind: 'success',
        message: '수집을 시작했습니다. 최신 상태를 다시 불러왔습니다.',
      });
      await refreshQuietly();
    } catch (error: unknown) {
      const message =
        error instanceof ApiError && error.problem.code === 'COL_008'
          ? QUIESCE_TRIGGER_MESSAGE
          : GENERIC_TRIGGER_ERROR_MESSAGE;
      setTriggerNotice({ kind: 'error', message });
    } finally {
      setIsTriggering(false);
    }
  }, [refreshQuietly]);

  return (
    <SystemStatusView
      state={state}
      onRetry={retry}
      onTrigger={handleTrigger}
      isTriggering={isTriggering}
      triggerNotice={triggerNotice}
    />
  );
}
