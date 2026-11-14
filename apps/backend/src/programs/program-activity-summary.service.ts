import { Inject, Injectable } from '@nestjs/common';
import {
  ProgramActivityRepository,
  type ProgramRepositoryActivity,
  ProgramActivitySummaryRepository,
} from './program-activity.repository';

export interface ProgramActivitySummary {
  readonly programId: string;
  readonly repositoryCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

@Injectable()
export class ProgramActivitySummaryService {
  constructor(
    @Inject(ProgramActivitySummaryRepository)
    private readonly repository: Pick<
      ProgramActivitySummaryRepository,
      'findRepositoryLinks'
    >,
    @Inject(ProgramActivityRepository)
    private readonly activity: Pick<
      ProgramActivityRepository,
      'findRepositoryActivity'
    >,
  ) {}

  async summarize(
    programIds: readonly string[],
  ): Promise<readonly ProgramActivitySummary[]> {
    if (programIds.length === 0) return [];

    const links = await this.repository.findRepositoryLinks(programIds);
    const repositoryIds = [
      ...new Set(links.map((link) => link.githubRepositoryId)),
    ];
    const activityRows = await this.activity.findRepositoryActivity({
      repositoryIds,
    });
    const activityByRepository = new Map(
      activityRows.map((activity) => [activity.repositoryId, activity]),
    );
    const byProgram = new Map<string, ProgramActivitySummary>(
      programIds.map((programId) => [
        programId,
        {
          programId,
          repositoryCount: 0,
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          lastActivityAt: null,
          dataAsOf: null,
        },
      ]),
    );

    for (const link of links) {
      const activity = activityByRepository.get(link.githubRepositoryId);
      const current = byProgram.get(link.programId);
      if (!current) continue;
      if (!activity) {
        byProgram.set(link.programId, {
          ...current,
          repositoryCount: current.repositoryCount + 1,
        });
        continue;
      }

      const lastActivityAt =
        newestActivityDate(activity)?.toISOString() ?? null;
      const dataAsOf = activity.dataAsOf?.toISOString() ?? null;

      byProgram.set(link.programId, {
        programId: current.programId,
        repositoryCount: current.repositoryCount + 1,
        commitCount: current.commitCount + activity.commitDates.length,
        pullRequestCount:
          current.pullRequestCount + activity.pullRequestDates.length,
        releaseCount: current.releaseCount + activity.releaseDates.length,
        lastActivityAt:
          current.lastActivityAt &&
          (!lastActivityAt || current.lastActivityAt > lastActivityAt)
            ? current.lastActivityAt
            : (lastActivityAt ?? current.lastActivityAt),
        dataAsOf:
          current.dataAsOf && (dataAsOf === null || current.dataAsOf > dataAsOf)
            ? current.dataAsOf
            : dataAsOf,
      });
    }

    return [...byProgram.values()];
  }
}

function newestActivityDate(activity: ProgramRepositoryActivity): Date | null {
  let newest: Date | null = null;
  for (const date of [
    ...activity.commitDates,
    ...activity.pullRequestDates,
    ...activity.releaseDates,
  ]) {
    if (!newest || newest < date) newest = date;
  }
  return newest;
}
