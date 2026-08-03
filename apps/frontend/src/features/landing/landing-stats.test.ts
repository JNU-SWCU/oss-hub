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

/** 프로그램 1 · 저장소 2 · 기여자 2 짜리 공개 그래프 */
const PUBLIC_GRAPH = graphOf('public', [
  'program',
  'repository',
  'repository',
  'student',
  'student',
]);

describe('landing stats display derivation', () => {
  it('hides the contributor count and badges 일부 집계 when the graph is partial', () => {
    // Given / When — 상세 일부가 전송 단계에서 실패한 2단계 그래프
    const stats = deriveLandingStats(PUBLIC_GRAPH, 'partial');

    /*
     * Then — 줄어든 기여자 수를 정확한 수처럼 내보내면 안 된다. 이 단언이 fail-safe
     * 의 소비 경계다: `isPartial` 을 무력화하면 여기서 깨져야 한다.
     */
    expect(stats.students).toBe('—');
    expect(stats.note).toBe('일부 집계');
    // 프로그램·저장소 수는 목록 하나에서 나오므로 부분 실패와 무관하게 정확하다
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
    // 1단계 그래프 — 기여자는 아직 0이라 `—` 로 나가지, 0 으로 나가지 않는다
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
