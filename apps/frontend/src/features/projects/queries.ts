'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { loadProjectDetail } from './api';

export function useProjectDetailQuery(projectId: string) {
  return useQuery({
    queryKey: featureKey('projects', projectId),
    queryFn: () => loadProjectDetail(projectId),
  });
}
