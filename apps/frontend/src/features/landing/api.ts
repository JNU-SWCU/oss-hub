import { apiClient, apiPath } from '@/lib/api-client';
import { buildPublicLandingGraph } from './landing-graph';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramPage,
} from './landing-overview';
import type {
  LandingGraph,
  LandingGraphCompleteness,
  LandingProgram,
} from './landing-overview';

/**
 * OAuth 진입은 fetch가 아니라 브라우저 이동(<a href>)이어야 한다.
 * landing은 auth feature 내부 경로에 의존하지 않고, 단일 클라이언트의
 * 경로 빌더(apiPath)만 재사용해 자체 상수를 갖는다.
 */
export const githubLoginPath = apiPath('auth/github');

export async function loadLandingPrograms(): Promise<
  readonly LandingProgram[]
> {
  return parseLandingProgramPage(
    await apiClient<unknown>(
      'programs?page=1&pageSize=3&search=&status=recruiting',
    ),
  );
}

/**
 * 랜딩 그래프는 두 단계로 도착한다.
 *
 * 공개 목록(`GET /projects`)에는 기여자가 없다 — 기여자는 상세(`GET /projects/:id`)
 * 에만 있고, 여러 프로젝트의 기여자를 한 번에 주는 공개 엔드포인트는 없다(백엔드
 * `PublicProjectsController` 확인). 그래서 요청 수 자체는 줄일 수 없다.
 *
 * 줄일 수 있는 건 "기다리는 시간"이다. 예전에는 상세 3건이 전부 도착할 때까지
 * 그래프를 통째로 붙들고 있었다. 이제 목록만으로 프로그램·저장소 노드를 먼저
 * 세우고(`base`), 학생 노드는 상세가 도착하는 대로 얹는다(`complete`).
 */
export interface LandingGraphStage {
  readonly graph: LandingGraph;
  /**
   * 이 그래프의 수치를 정확한 값으로 내보여도 되는지. `partial`이면 화면은
   * 기여자 수를 숨기고 `일부 집계`로 표기한다(`landing-journey.tsx`).
   */
  readonly completeness: LandingGraphCompleteness;
}

export interface LandingGraphStages {
  /** 목록 응답 하나로 세운 1단계 그래프. 학생 노드는 아직 없다. */
  readonly base: LandingGraphStage;
  /** 상세가 모두 정착한 2단계 그래프. 실패한 상세는 그 프로젝트의 기여자만 빠진다. */
  readonly complete: Promise<LandingGraphStage>;
}

export async function streamLandingGraph(): Promise<LandingGraphStages> {
  const archive = parseLandingArchivePage(
    await apiClient<unknown>('projects?pageSize=3'),
  );

  /*
   * 상세 하나에서 일어나는 실패는 두 가지고, 둘을 같이 삼키면 안 된다.
   *
   * 전송 실패(요청 자체가 실패)는 그 프로젝트의 기여자 선에서 끊는다. 목록까지
   * 버리면 진짜 공개 데이터를 다 들고도 예시 그래프로 되돌아가기 때문이다. 대신
   * 줄어든 집계라는 표(`partial`)를 남겨 화면이 그 수를 정확한 값으로 내보이지
   * 않게 한다.
   *
   * 계약 위반(응답은 왔는데 형식이 다름)은 삼키지 않고 던진다. 조용히 넘기면
   * 줄어든 기여자 수가 `공개 아카이브 기준`이라는 정확한 수치로 화면에 걸린다.
   * 틀린 수를 맞는 수처럼 보여 주느니 2단계를 통째로 실패시키고 1단계 그래프에
   * 머무는 편이 낫다.
   */
  const details = archive.map(async ({ projectId }) => {
    let response: unknown;
    try {
      response = await apiClient<unknown>(
        `projects/${encodeURIComponent(projectId)}`,
      );
    } catch {
      return null;
    }
    return parseLandingArchiveDetail(response);
  });

  return {
    base: {
      graph: buildPublicLandingGraph(archive, []),
      completeness: 'complete',
    },
    // 상세 3건은 순차가 아니라 동시에 나간다 — 목록 이후 왕복은 한 번뿐이다.
    complete: Promise.all(details).then((settled): LandingGraphStage => {
      const arrived = settled.filter((detail) => detail !== null);
      return {
        graph: buildPublicLandingGraph(archive, arrived),
        completeness:
          arrived.length === settled.length ? 'complete' : 'partial',
      };
    }),
  };
}
