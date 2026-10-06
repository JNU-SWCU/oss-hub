'use client';

import { useEffect, useState } from 'react';
import { streamLandingGraph } from '../api';
import type { LandingGraphStage } from '../api';
import { LANDING_GRAPH_EXAMPLE } from '../landing-graph';
import type {
  LandingGraph,
  LandingGraphCompleteness,
} from '../landing-overview';

interface LandingGraphState {
  readonly graph: LandingGraph;

  readonly completeness: LandingGraphCompleteness;
  readonly isLocalhost: boolean;
}

const EXAMPLE_STAGE: LandingGraphStage = {
  graph: LANDING_GRAPH_EXAMPLE,
  completeness: 'complete',
};

export function useLandingGraph(): LandingGraphState {
  const [stage, setStage] = useState<LandingGraphStage>(EXAMPLE_STAGE);
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLocalhost(
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1',
    );

    void streamLandingGraph()
      .then(async ({ base, complete }) => {
        if (active) setStage(base);
        const enriched = await complete;
        if (active) setStage(enriched);
      })
      .catch((error: unknown) => {
        if (error instanceof Error) return;
        throw error;
      });
    return () => {
      active = false;
    };
  }, []);

  return {
    graph: stage.graph,
    completeness: stage.completeness,
    isLocalhost,
  };
}
