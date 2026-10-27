import { apiClient } from '@/lib/api-client';
import { COSMOS_PROGRAM_COUNT } from './cosmos';
import { buildPublicLandingGraph } from './landing-graph';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramNamePage,
  parseLandingProgramPage,
} from './landing-overview';
import type {
  LandingGraph,
  LandingGraphCompleteness,
  LandingProgram,
  LandingProgramName,
} from './landing-overview';

export async function loadLandingPrograms(): Promise<
  readonly LandingProgram[]
> {
  return parseLandingProgramPage(
    await apiClient<unknown>(
      'programs?page=1&pageSize=3&search=&status=recruiting',
    ),
  );
}

export async function loadLandingProgramNames(): Promise<
  readonly LandingProgramName[]
> {
  return parseLandingProgramNamePage(
    await apiClient<unknown>(
      `programs?page=1&pageSize=${COSMOS_PROGRAM_COUNT}&search=&status=all`,
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
  const archive = parseLandingArchivePage(
    await apiClient<unknown>('projects?pageSize=3'),
  );

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
