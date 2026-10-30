import type { LandingGraph, LandingGraphNodeKind } from './landing-overview';

interface LandingStatItem {
  readonly key: string;
  readonly value: string;
}

export interface LandingStatsDisplay {
  readonly items: readonly LandingStatItem[];
  readonly note: string | null;
}

function countByKind(graph: LandingGraph, kind: LandingGraphNodeKind): number {
  return graph.nodes.filter((node) => node.kind === kind).length;
}

export function deriveLandingStats(graph: LandingGraph): LandingStatsDisplay {
  const counts: readonly (readonly [string, number])[] = [
    ['공개 프로그램', countByKind(graph, 'program')],
    ['공개 저장소', countByKind(graph, 'repository')],
    ['공개 기여자', countByKind(graph, 'student')],
  ];
  const items = counts.flatMap(([key, count]) =>
    count ? [{ key, value: String(count) }] : [],
  );
  if (items.length === 0) return { items, note: null };

  return {
    items,
    note: '공개 프로젝트 기준',
  };
}
