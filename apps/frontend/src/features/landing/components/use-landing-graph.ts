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
  /** 이 그래프의 수치를 정확한 값으로 내보여도 되는지 */
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
    // 목록이 도착하면 곧바로 예시 그래프를 공개 데이터로 갈아 끼우고, 기여자는
    // 상세가 도착한 뒤 한 번 더 얹는다. 상세를 기다리느라 예시를 붙들고 있으면
    // 방문자는 이미 받아 둔 진짜 데이터를 못 본 채 왕복 한 번을 더 기다린다.
    //
    // 2단계가 실패하면(상세 응답이 계약을 어긴 경우) 1단계 그래프에 머문다.
    // 1단계는 기여자가 0이라 화면이 `—`로 내보내므로, 줄어든 수를 정확한 수처럼
    // 보여 주는 일이 없다.
    void streamLandingGraph()
      .then(async ({ base, complete }) => {
        if (!active) return;
        setStage(base);
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
