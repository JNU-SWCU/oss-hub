'use client';

import { useMyRepositoriesQuery } from '../queries';
import type { MyRepositoriesState } from '../types';
import { MyRepositoriesView } from './my-repositories-view';

export function MyRepositoriesScreen() {
  const query = useMyRepositoriesQuery();
  const state: MyRepositoriesState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? { kind: 'error' }
      : { kind: 'ready', repositories: query.data };

  return (
    <MyRepositoriesView state={state} onRetry={() => void query.refetch()} />
  );
}
