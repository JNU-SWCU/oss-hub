'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadMyRepositories } from '../loader';
import type { MyRepositoriesState } from '../types';
import { MyRepositoriesView } from './my-repositories-view';

export function MyRepositoriesScreen() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MyRepositoriesState>({ kind: 'loading' });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadMyRepositories()
      .then((repositories) => {
        if (active) setState({ kind: 'ready', repositories });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return <MyRepositoriesView state={state} onRetry={retry} />;
}
