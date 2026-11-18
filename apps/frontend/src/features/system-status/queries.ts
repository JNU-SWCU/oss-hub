'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { fetchSystemStatus } from './api';

export function useSystemStatusQuery(staleRepositoryPage: number) {
  return useQuery({
    queryKey: featureKey('system-status', staleRepositoryPage),
    queryFn: () => fetchSystemStatus(staleRepositoryPage),
    placeholderData: keepPreviousData,
  });
}
