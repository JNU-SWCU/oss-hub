import { apiClient } from '@/lib/api-client';
import type { ActivityGranularity, ActivityTimeline } from './types';

export function fetchActivityTimeline(
  granularity: ActivityGranularity,
): Promise<ActivityTimeline> {
  const search = new URLSearchParams({ granularity });
  return apiClient<ActivityTimeline>(
    `dashboard/student/activity-timeline?${search.toString()}`,
  );
}
