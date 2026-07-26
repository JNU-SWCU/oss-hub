'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchSystemStatus } from '../api';
import type { SystemStatusViewState } from '../types';
import { SystemStatusView } from './system-status-view';

export function SystemStatusScreen() {
  const [state, setState] = useState<SystemStatusViewState>({
    kind: 'loading',
  });
  const [requestKey, setRequestKey] = useState(0);
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

  return <SystemStatusView state={state} onRetry={retry} />;
}
