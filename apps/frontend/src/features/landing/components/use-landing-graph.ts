'use client';

import { useEffect, useState } from 'react';
import { streamLandingGraph } from '../api';
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
    // 목록이 도착하면 곧바로 예시 그래프를 공개 데이터로 갈아 끼우고, 기여자는
    // 상세가 도착한 뒤 한 번 더 얹는다. 상세를 기다리느라 예시를 붙들고 있으면
    // 방문자는 이미 받아 둔 진짜 데이터를 못 본 채 왕복 한 번을 더 기다린다.
    void streamLandingGraph()
      .then(async ({ base, complete }) => {
        if (!active) return;
        setGraph(base);
        const enriched = await complete;
        if (active) setGraph(enriched);
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
