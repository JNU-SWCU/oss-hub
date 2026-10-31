'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { fetchSystemStatus } from './api';

export function useSystemStatusQuery() {
  return useQuery({
    queryKey: featureKey('system-status'),
    queryFn: fetchSystemStatus,
  });
}
