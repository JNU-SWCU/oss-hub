'use client';

import { useEffect, useState } from 'react';
import { loadLandingGraph } from '../api';
import { LANDING_GRAPH_EXAMPLE } from '../landing-graph';
import type { LandingGraph } from '../landing-overview';

interface LandingGraphState {
  readonly graph: LandingGraph;
  readonly isLocalhost: boolean;
}

export function useLandingGraph(): LandingGraphState {
  const [graph, setGraph] = useState<LandingGraph>(LANDING_GRAPH_EXAMPLE);
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLocalhost(
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1',
    );
    void loadLandingGraph()
      .then((nextGraph) => {
        if (active) setGraph(nextGraph);
      })
      .catch((error: unknown) => {
        if (error instanceof Error) return;
        throw error;
      });
    return () => {
      active = false;
    };
  }, []);

  return { graph, isLocalhost };
}
