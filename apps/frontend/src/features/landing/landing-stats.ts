import type {
  LandingGraph,
  LandingGraphCompleteness,
} from './landing-overview';

/** 두 번째 패널이 실제로 화면에 거는 값. 숫자가 아니라 표시 문자열이다. */
export interface LandingStatsDisplay {
  readonly programs: string;
  readonly repositories: string;
  readonly students: string;
  /** 수치의 출처 배지 */
  readonly note: string;
}

interface GraphCounts {
  readonly programs: number;
  readonly repositories: number;
  readonly students: number;
}

/** 공개 집계가 아직 없을 때 0을 늘어놓지 않는다 — 없는 것은 없다고 표시한다 */
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

/**
 * 공개 그래프와 그 완전성으로 두 번째 패널의 표시값을 만든다.
 *
 * 컴포넌트 밖의 순수 파생으로 둔 이유는 이 함수가 fail-safe 의 소비 경계이기
 * 때문이다. `partial` 을 받고도 기여자 수를 그대로 내보내면, 전송 실패로 줄어든
 * 수가 `공개 아카이브 기준` 이라는 정확한 수치의 얼굴을 하고 화면에 걸린다.
 * 그 경계는 렌더 테스트가 아니라 인접 단위 테스트로 못 박는다
 * (`landing-stats.test.ts`).
 */
export function deriveLandingStats(
  graph: LandingGraph,
  completeness: LandingGraphCompleteness,
): LandingStatsDisplay {
  const counts = countByKind(graph);
  const hasCounts = counts.programs + counts.repositories + counts.students > 0;
  /*
   * 상세 일부가 전송 단계에서 실패하면 기여자 수는 실제보다 적다. 프로그램·저장소
   * 수는 목록 하나에서 나오므로 그대로 정확하다. 줄어든 것은 기여자뿐이니, 기여자
   * 자리만 `—`로 비우고 배지로 `일부 집계`임을 밝힌다.
   */
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
