'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchActivityTimeline } from '../api';
import type {
  ActivityGranularity,
  ActivityTimeline,
  ActivityTimelineStatus,
} from '../types';
import { ActivityTimelineView } from './activity-timeline-view';

export function ActivityTimelineScreen() {
  const [granularity, setGranularity] =
    useState<ActivityGranularity>('MONTH');
  const [data, setData] = useState<ActivityTimeline | null>(null);
  const [status, setStatus] = useState<ActivityTimelineStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setData(null);
    setStatus('loading');

    fetchActivityTimeline(granularity)
      .then((nextData) => {
        if (active) {
          setData(nextData);
          setStatus('success');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [granularity, requestKey]);

  return (
    <ActivityTimelineView
      data={data}
      granularity={granularity}
      status={status}
      onGranularityChange={setGranularity}
      onRetry={retry}
    />
  );
}
