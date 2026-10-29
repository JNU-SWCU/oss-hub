import type {
  LandingGraph,
  LandingGraphCompleteness,
} from './landing-overview';

export interface LandingStatsDisplay {
  readonly programs: string;
  readonly repositories: string;
  readonly students: string;

  readonly note: string;
}

interface GraphCounts {
  readonly programs: number;
  readonly repositories: number;
  readonly students: number;
}

function formatCount(value: number): string {
  return value > 0 ? String(value) : '—';
}

function countByKind(graph: LandingGraph): GraphCounts {
  return {
    programs: graph.nodes.filter((node) => node.kind === 'program').length,
    repositories: graph.nodes.filter((node) => node.kind === 'repository')
      .length,
    students: graph.nodes.filter((node) => node.kind === 'student').length,
  };
}

export function deriveLandingStats(
  graph: LandingGraph,
  completeness: LandingGraphCompleteness,
): LandingStatsDisplay {
  const counts = countByKind(graph);
  const hasCounts = counts.programs + counts.repositories + counts.students > 0;

  const isPartial = completeness === 'partial';

  return {
    programs: formatCount(counts.programs),
    repositories: formatCount(counts.repositories),
    students: isPartial ? '—' : formatCount(counts.students),
    note: !hasCounts
      ? '공개 집계 준비 중'
      : isPartial
        ? '일부 집계'
        : graph.source === 'public'
          ? '공개 아카이브 기준'
          : '예시 데이터 기준',
  };
}
