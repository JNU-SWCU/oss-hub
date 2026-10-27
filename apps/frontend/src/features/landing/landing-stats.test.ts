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
  it('omits the contributor item and badges 일부 집계 when the graph is partial', () => {
    expect(deriveLandingStats(PUBLIC_GRAPH, 'partial')).toEqual({
      items: [
        { key: '공개 프로그램', value: '1' },
        { key: '공개 저장소', value: '2' },
      ],
      note: '일부 집계',
    });
  });

  it('shows exact counts under 공개 아카이브 기준 when the public graph is complete', () => {
    expect(deriveLandingStats(PUBLIC_GRAPH, 'complete')).toEqual({
      items: [
        { key: '공개 프로그램', value: '1' },
        { key: '공개 저장소', value: '2' },
        { key: '공개 기여자', value: '2' },
      ],
      note: '공개 아카이브 기준',
    });
  });

  it('drops a zero count instead of rendering a pending placeholder', () => {
    const base = graphOf('public', ['program', 'repository', 'repository']);

    expect(deriveLandingStats(base, 'complete')).toEqual({
      items: [
        { key: '공개 프로그램', value: '1' },
        { key: '공개 저장소', value: '2' },
      ],
      note: '공개 아카이브 기준',
    });
  });

  it('shows no counts or note for the seeded example graph', () => {
    const stats = deriveLandingStats(
      graphOf('example', ['program', 'repository', 'student']),
      'complete',
    );

    expect(stats).toEqual({ items: [], note: null });
  });

  it('returns no items and no note when nothing has been counted', () => {
    const empty = graphOf('public', []);

    expect(deriveLandingStats(empty, 'complete')).toEqual({
      items: [],
      note: null,
    });
    expect(deriveLandingStats(empty, 'partial')).toEqual({
      items: [],
      note: null,
    });
  });
});
