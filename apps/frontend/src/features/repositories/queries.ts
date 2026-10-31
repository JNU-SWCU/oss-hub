'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { loadMyRepositories } from './loader';

export function useMyRepositoriesQuery() {
  return useQuery({
    queryKey: featureKey('repositories', 'me'),
    queryFn: loadMyRepositories,
  });
}
