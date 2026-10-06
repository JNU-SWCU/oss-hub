import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  LandingGraph,
  LandingGraphCompleteness,
  LandingGraphNode,
  LandingGraphNodeKind,
} from './landing-overview';

const mocks = vi.hoisted(() => ({ useLandingGraph: vi.fn() }));

vi.mock('./components/use-landing-graph', () => ({
  useLandingGraph: mocks.useLandingGraph,
}));

import { LandingJourney } from './components/landing-journey';

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

function renderWith(completeness: LandingGraphCompleteness): string {
  mocks.useLandingGraph.mockReturnValue({
    graph: PUBLIC_GRAPH,
    completeness,
    isLocalhost: false,
  });
  return renderToStaticMarkup(
    <LandingJourney primaryAction={<a href="/login">GitHub으로 로그인</a>} />,
  );
}

const statValue = (html: string, key: string): string | undefined =>
  new RegExp(`>([^<>]*)</div><div[^>]*>${key}</div>`).exec(html)?.[1];

describe('LandingJourney second panel stats', () => {
  it('renders the contributor slot as an em dash and badges 일부 집계 when the graph is partial', () => {
    const html = renderWith('partial');

    expect(statValue(html, '공개 기여자')).toBe('—');
    expect(html).toContain('일부 집계');
    expect(html).not.toContain('공개 아카이브 기준');

    expect(statValue(html, '공개 프로그램')).toBe('1');
    expect(statValue(html, '공개 저장소')).toBe('2');
  });

  it('renders exact counts under 공개 아카이브 기준 when the graph is complete', () => {
    const html = renderWith('complete');

    expect(statValue(html, '공개 기여자')).toBe('2');
    expect(html).toContain('공개 아카이브 기준');
    expect(html).not.toContain('일부 집계');
  });
});
