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

export async function loadLandingGraph(): Promise<LandingGraph> {
  const archive = parseLandingArchivePage(
    await apiClient<unknown>('projects?pageSize=3'),
  );
  const details = await Promise.all(
    archive.map(async ({ projectId }) =>
      parseLandingArchiveDetail(
        await apiClient<unknown>(`projects/${encodeURIComponent(projectId)}`),
      ),
    ),
  );
  return buildPublicLandingGraph(archive, details);
}
