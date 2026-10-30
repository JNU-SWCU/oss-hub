import { apiClient, apiPath } from '@/lib/api-client';
import { buildPublicLandingGraph } from './landing-graph';
import {
  parseLandingProjectDetail,
  parseLandingProjectPage,
  parseLandingProgramPage,
} from './landing-overview';
import type {
  LandingGraph,
  LandingGraphCompleteness,
  LandingProgram,
} from './landing-overview';

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

export interface LandingGraphStage {
  readonly graph: LandingGraph;

  readonly completeness: LandingGraphCompleteness;
}

export interface LandingGraphStages {
  readonly base: LandingGraphStage;

  readonly complete: Promise<LandingGraphStage>;
}

export async function streamLandingGraph(): Promise<LandingGraphStages> {
  const projects = parseLandingProjectPage(
    await apiClient<unknown>('projects?pageSize=3'),
  );

  const details = projects.map(async ({ projectId }) => {
    let response: unknown;
    try {
      response = await apiClient<unknown>(
        `projects/${encodeURIComponent(projectId)}`,
      );
    } catch {
      return null;
    }
    return parseLandingProjectDetail(response);
  });

  return {
    base: {
      graph: buildPublicLandingGraph(projects, []),
      completeness: 'complete',
    },

    complete: Promise.all(details).then((settled): LandingGraphStage => {
      const arrived = settled.filter((detail) => detail !== null);
      return {
        graph: buildPublicLandingGraph(projects, arrived),
        completeness:
          arrived.length === settled.length ? 'complete' : 'partial',
      };
    }),
  };
}
