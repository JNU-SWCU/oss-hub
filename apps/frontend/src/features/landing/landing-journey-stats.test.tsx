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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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

function renderWith(
  completeness: LandingGraphCompleteness,
  graph: LandingGraph = PUBLIC_GRAPH,
): string {
  mocks.useLandingGraph.mockReturnValue({
    graph,
    completeness,
    programs: [],
  });
  return renderToStaticMarkup(
    <LandingJourney primaryAction={<a href="/login">GitHub으로 로그인</a>} />,
  );
}

const statValue = (html: string, key: string): string | undefined =>
  new RegExp(`>([^<>]*)</div><div[^>]*>${key}</div>`).exec(html)?.[1];

describe('LandingJourney program story stats', () => {
  it('omits the contributor slot and badges 일부 집계 when the graph is partial', () => {
    const html = renderWith('partial');

    expect(statValue(html, '공개 프로그램')).toBe('1');
    expect(statValue(html, '공개 저장소')).toBe('2');
    expect(html).not.toContain('공개 기여자');
    expect(html).not.toContain('집계 중');
    expect(html).not.toContain('data-pending');
    expect(html).toContain('일부 집계');
    expect(html).not.toContain('공개 아카이브 기준');
  });

  it('renders exact counts under 공개 아카이브 기준 when the graph is complete', () => {
    const html = renderWith('complete');

    expect(statValue(html, '공개 기여자')).toBe('2');
    expect(html).toContain('공개 아카이브 기준');
    expect(html).not.toContain('일부 집계');
  });

  it('renders no stats row and no note when nothing has been counted', () => {
    const html = renderWith('complete', graphOf('public', []));

    expect(html).not.toContain('<ul');
    expect(html).not.toContain('공개 프로그램');
    expect(html).not.toContain('공개 저장소');
    expect(html).not.toContain('공개 기여자');
    expect(html).not.toContain('집계');
    expect(html).not.toContain('공개 아카이브 기준');
    expect(html).not.toContain('예시 데이터 기준');
  });
});
