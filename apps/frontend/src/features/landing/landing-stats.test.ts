import { describe, expect, it } from 'vitest';
import type {
  LandingGraph,
  LandingGraphNode,
  LandingGraphNodeKind,
} from './landing-overview';
import { deriveLandingStats } from './landing-stats';

const graphOf = (
  source: LandingGraph['source'],
  kinds: readonly LandingGraphNodeKind[],
): LandingGraph => ({
  source,
  nodes: kinds.map((kind, index): LandingGraphNode => ({
    id: `${kind}:${index}`,
    kind,
    label: `${kind}-${index}`,
    href: null,
    x: 0,
    y: 0,
  })),
  edges: [],
});

const PUBLIC_GRAPH = graphOf('public', [
  'program',
  'repository',
  'repository',
  'student',
  'student',
]);

describe('landing stats display derivation', () => {
  it('hides the contributor count and badges 일부 집계 when the graph is partial', () => {
    const stats = deriveLandingStats(PUBLIC_GRAPH, 'partial');

    expect(stats.students).toBe('—');
    expect(stats.note).toBe('일부 집계');

    expect(stats.programs).toBe('1');
    expect(stats.repositories).toBe('2');
  });

  it('shows exact counts under 공개 아카이브 기준 when the public graph is complete', () => {
    expect(deriveLandingStats(PUBLIC_GRAPH, 'complete')).toEqual({
      programs: '1',
      repositories: '2',
      students: '2',
      note: '공개 아카이브 기준',
    });
  });

  it('keeps 공개 아카이브 기준 with an em dash while the first stage has no contributors yet', () => {
    const base = graphOf('public', ['program', 'repository', 'repository']);

    expect(deriveLandingStats(base, 'complete')).toEqual({
      programs: '1',
      repositories: '2',
      students: '—',
      note: '공개 아카이브 기준',
    });
  });

  it('labels the seeded example graph as 예시 데이터 기준', () => {
    const stats = deriveLandingStats(
      graphOf('example', ['program', 'repository', 'student']),
      'complete',
    );

    expect(stats.note).toBe('예시 데이터 기준');
    expect(stats.students).toBe('1');
  });

  it('falls back to 공개 집계 준비 중 when nothing has been counted', () => {
    expect(deriveLandingStats(graphOf('public', []), 'complete')).toEqual({
      programs: '—',
      repositories: '—',
      students: '—',
      note: '공개 집계 준비 중',
    });
  });
});
