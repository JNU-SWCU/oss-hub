'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadLandingProgramNames, streamLandingGraph } from '../api';
import type { LandingGraphStage } from '../api';
import type { CosmosProgram } from '../cosmos';
import {
  LANDING_GRAPH_EXAMPLE,
  selectLandingStarPrograms,
} from '../landing-graph';
import type { LandingProgramName } from '../landing-overview';

const EXAMPLE_STAGE: LandingGraphStage = {
  graph: LANDING_GRAPH_EXAMPLE,
  completeness: 'complete',
};

export interface LandingGraphState extends LandingGraphStage {
  readonly programs: readonly CosmosProgram[];
}

const ignoreRequestFailure = (error: unknown): void => {
  if (error instanceof Error) return;
  throw error;
};

export function useLandingGraph(): LandingGraphState {
  const [stage, setStage] = useState<LandingGraphStage>(EXAMPLE_STAGE);
  const [names, setNames] = useState<readonly LandingProgramName[]>([]);

  useEffect(() => {
    let active = true;

    void streamLandingGraph()
      .then(async ({ base, complete }) => {
        if (active) setStage(base);
        const enriched = await complete;
        if (active) setStage(enriched);
      })
      .catch(ignoreRequestFailure);
    void loadLandingProgramNames()
      .then((loaded) => {
        if (active) setNames(loaded);
      })
      .catch(ignoreRequestFailure);
    return () => {
      active = false;
    };
  }, []);

  const programs = useMemo(
    () => selectLandingStarPrograms(stage.graph, names),
    [stage.graph, names],
  );

  return { ...stage, programs };
}
