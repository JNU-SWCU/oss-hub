import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  LandingGraph,
  LandingGraphCompleteness,
  LandingGraphNode,
  LandingGraphNodeKind,
} from './landing-overview';

const mocks = vi.hoisted(() => ({ useLandingGraph: vi.fn() }));

/*
 * 훅을 목으로 바꾸면 완전성이 첫 렌더에 이미 손에 있다. 실제 훅은 `useEffect`
 * 안에서 공개 그래프를 받아 오므로 정적 렌더에서는 늘 예시 그래프에 머물고,
 * 그래서 `landing.test.tsx` 의 조합 확인만으로는 `completeness` 를 실제로 넘기는
 * 것과 `'complete'` 로 고정한 것을 구분하지 못했다. 목은 그 한 칸을 잠근다.
 */
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

/** 프로그램 1 · 저장소 2 · 기여자 2 짜리 공개 그래프 */
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

/** CSS module 클래스명은 해시로 바뀌므로 옆에 붙은 항목 이름으로 값을 집는다 */
const statValue = (html: string, key: string): string | undefined =>
  new RegExp(`>([^<>]*)</div><div[^>]*>${key}</div>`).exec(html)?.[1];

describe('LandingJourney second panel stats', () => {
  it('renders the contributor slot as an em dash and badges 일부 집계 when the graph is partial', () => {
    const html = renderWith('partial');

    expect(statValue(html, '공개 기여자')).toBe('—');
    expect(html).toContain('일부 집계');
    expect(html).not.toContain('공개 아카이브 기준');
    // 프로그램·저장소는 목록 하나에서 나오므로 부분 실패와 무관하게 정확하다
    expect(statValue(html, '공개 프로그램')).toBe('1');
    expect(statValue(html, '공개 저장소')).toBe('2');
  });

  it('renders exact counts under 공개 아카이브 기준 when the graph is complete', () => {
    const html = renderWith('complete');

    expect(statValue(html, '공개 기여자')).toBe('2');
    expect(html).toContain('공개 아카이브 기준');
    expect(html).not.toContain('일부 집계');
  });

  /*
   * 배선 한 칸을 직접 겨눈다. 같은 그래프인데 완전성만 다르면 화면이 달라져야
   * 한다. `deriveLandingStats(publicGraph, 'complete')` 처럼 완전성을 넘기지 않고
   * 고정하면 두 렌더가 같아져 여기서 깨진다.
   */
  it('threads completeness into the derivation — the same graph renders differently', () => {
    const complete = renderWith('complete');
    const partial = renderWith('partial');

    expect(statValue(complete, '공개 기여자')).toBe('2');
    expect(statValue(partial, '공개 기여자')).toBe('—');
    expect(partial).not.toBe(complete);
  });
});
