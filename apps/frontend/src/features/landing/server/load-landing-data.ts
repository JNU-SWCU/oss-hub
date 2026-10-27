import 'server-only';

import { serverApiClient } from '@/lib/server-api-client';
import { programOverviewHref } from '@/lib/program-route';
import { COSMOS_PROGRAM_COUNT } from '../cosmos/cosmos-graph';
import { buildPublicLandingGraph } from '../landing-graph';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
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
  const archive = parseLandingArchivePage(
    await landingJson('projects?pageSize=3'),
  );
  const details = await Promise.all(
    archive.map(async ({ projectId }) =>
      parseLandingArchiveDetail(
        await landingJson(`projects/${encodeURIComponent(projectId)}`),
      ),
    ),
  );
  return deriveLandingStats(buildPublicLandingGraph(archive, details));
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
