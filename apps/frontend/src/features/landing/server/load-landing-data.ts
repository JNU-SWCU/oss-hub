import 'server-only';

import { ServerApiError, serverApiClient } from '@/lib/server-api-client';
import { programOverviewHref } from '@/lib/program-route';
import { COSMOS_PROGRAM_COUNT } from '../cosmos/cosmos-graph';
import { buildPublicLandingGraph } from '../landing-graph';
import {
  parseLandingProjectDetail,
  parseLandingProjectPage,
  parseLandingProgramNamePage,
  parseLandingProgramPage,
} from '../landing-overview';
import type { LandingProgram } from '../landing-overview';
import type { CosmosProgram } from '../cosmos/cosmos-graph';
import { deriveLandingStats } from '../landing-stats';
import type { LandingStatsDisplay } from '../landing-stats';

export interface LandingData {
  readonly recruiting: readonly LandingProgram[];
  readonly starPrograms: readonly CosmosProgram[];
  readonly stats: LandingStatsDisplay;
}

const landingJson = (path: string): Promise<unknown> =>
  serverApiClient(path, { revalidate: 300, tags: ['landing'] });

async function loadStats(): Promise<LandingStatsDisplay> {
  const projects = parseLandingProjectPage(
    await landingJson('projects?pageSize=3'),
  );
  const details = await Promise.all(
    projects.map(async ({ projectId }) =>
      parseLandingProjectDetail(
        await landingJson(`projects/${encodeURIComponent(projectId)}`),
      ),
    ),
  );
  return deriveLandingStats(buildPublicLandingGraph(projects, details));
}

function arrived<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  part: string,
): T {
  switch (result.status) {
    case 'fulfilled':
      return result.value;
    case 'rejected':
      console.warn('landing.data.unavailable', {
        part,
        error:
          result.reason instanceof Error ? result.reason.name : 'UnknownError',
        status:
          result.reason instanceof ServerApiError
            ? result.reason.status
            : undefined,
      });
      return fallback;
  }
}

export async function loadLandingData(): Promise<LandingData> {
  const [recruiting, names, stats] = await Promise.allSettled([
    landingJson('programs?page=1&pageSize=3&search=&status=recruiting').then(
      parseLandingProgramPage,
    ),
    landingJson(
      `programs?page=1&pageSize=${COSMOS_PROGRAM_COUNT}&search=&status=all`,
    ).then(parseLandingProgramNamePage),
    loadStats(),
  ]);
  return {
    recruiting: arrived(recruiting, [], 'recruiting'),
    starPrograms: arrived(names, [], 'starPrograms').map((program) => ({
      name: program.name,
      href: programOverviewHref(program.id),
    })),
    stats: arrived(stats, { items: [], note: null }, 'stats'),
  };
}
