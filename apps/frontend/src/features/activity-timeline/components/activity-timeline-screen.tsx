'use client';

import { useActivityTimelineUrlState } from '../activity-timeline-url-state';
import { useActivityTimelineQuery } from '../queries';
import { ActivityTimelineView } from './activity-timeline-view';

export function ActivityTimelineScreen() {
  const {
    state: { granularity },
    navigate,
  } = useActivityTimelineUrlState();
  const query = useActivityTimelineQuery(granularity);
  return (
    <ActivityTimelineView
      data={query.data ?? null}
      granularity={granularity}
      status={query.isPending ? 'loading' : query.isError ? 'error' : 'success'}
      onGranularityChange={(next) => navigate({ granularity: next })}
      onRetry={() => void query.refetch()}
    />
  );
}
