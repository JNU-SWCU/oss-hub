'use client';

import { useEffect, useState } from 'react';
import { streamLandingGraph } from '../api';
import type { LandingGraphStage } from '../api';
import { LANDING_GRAPH_EXAMPLE } from '../landing-graph';

const EXAMPLE_STAGE: LandingGraphStage = {
  graph: LANDING_GRAPH_EXAMPLE,
  completeness: 'complete',
};

export function useLandingGraph(): LandingGraphStage {
  const [stage, setStage] = useState<LandingGraphStage>(EXAMPLE_STAGE);

  useEffect(() => {
    let active = true;

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

  return stage;
}
