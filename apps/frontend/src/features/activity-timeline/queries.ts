import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { fetchActivityTimeline } from './api';
import type { ActivityGranularity } from './types';

export function useActivityTimelineQuery(granularity: ActivityGranularity) {
  return useQuery({
    queryKey: featureKey('activity-timeline', granularity),
    queryFn: () => fetchActivityTimeline(granularity),
  });
}
