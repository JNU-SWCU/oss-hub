'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadMilestoneTimeline } from '../loader';
import type {
  MilestoneTimelineFixture,
  MilestoneTimelineState,
} from '../types';
import { MilestoneTimelineView } from './milestone-timeline-view';

export function MilestoneTimelineScreen({
  programId,
  fixture,
}: {
  readonly programId: string;
  readonly fixture: MilestoneTimelineFixture | null;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MilestoneTimelineState>({
    kind: 'loading',
  });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadMilestoneTimeline({ programId, fixture, attempt })
      .then((timeline) => {
        if (active) setState({ kind: 'ready', timeline });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: 'error' });
        if (!(error instanceof Error)) throw error;
      });
    return () => {
      active = false;
    };
  }, [attempt, fixture, programId]);

  return <MilestoneTimelineView state={state} onRetry={retry} />;
}
