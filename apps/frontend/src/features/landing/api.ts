import { apiClient, apiPath } from '@/lib/api-client';
import { buildPublicLandingGraph } from './landing-graph';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramPage,
} from './landing-overview';
import type { LandingGraph, LandingProgram } from './landing-overview';

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
export interface LandingGraphStages {
  /** 목록 응답 하나로 세운 1단계 그래프. 학생 노드는 아직 없다. */
  readonly base: LandingGraph;
  /** 상세가 모두 정착한 2단계 그래프. 실패한 상세는 그 프로젝트의 기여자만 빠진다. */
  readonly complete: Promise<LandingGraph>;
}

export async function streamLandingGraph(): Promise<LandingGraphStages> {
  const archive = parseLandingArchivePage(
    await apiClient<unknown>('projects?pageSize=3'),
  );

  /*
   * 상세 하나가 실패했다고 목록까지 버리면, 진짜 공개 데이터를 다 들고도 예시
   * 그래프로 되돌아간다. 실패는 그 프로젝트의 기여자 선에서 끊는다.
   */
  const details = archive.map(async ({ projectId }) => {
    try {
      return parseLandingArchiveDetail(
        await apiClient<unknown>(`projects/${encodeURIComponent(projectId)}`),
      );
    } catch {
      return null;
    }
  });

  return {
    base: buildPublicLandingGraph(archive, []),
    // 상세 3건은 순차가 아니라 동시에 나간다 — 목록 이후 왕복은 한 번뿐이다.
    complete: Promise.all(details).then((settled) =>
      buildPublicLandingGraph(
        archive,
        settled.filter((detail) => detail !== null),
      ),
    ),
  };
}
