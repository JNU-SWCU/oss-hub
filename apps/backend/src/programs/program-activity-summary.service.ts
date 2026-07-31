import { Inject, Injectable } from '@nestjs/common';
import { ProgramActivitySummaryRepository } from './program-activity-summary.repository';

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
      'findRepositoryLinks' | 'findCanonicalActivity'
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
    const canonicalRows =
      await this.repository.findCanonicalActivity(repositoryIds);
    const canonicalByRepository = new Map(
      canonicalRows.map((row) => [row.githubRepositoryId, row]),
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
      const canonical = canonicalByRepository.get(link.githubRepositoryId);
      const current = byProgram.get(link.programId);
      if (!current) continue;
      if (!canonical) {
        byProgram.set(link.programId, {
          ...current,
          repositoryCount: current.repositoryCount + 1,
        });
        continue;
      }

      const lastActivityAt = canonical.lastActivityAt?.toISOString() ?? null;
      const dataAsOf = canonical.dataAsOf.toISOString();

      byProgram.set(link.programId, {
        programId: current.programId,
        repositoryCount: current.repositoryCount + 1,
        commitCount: current.commitCount + canonical.commitCount,
        pullRequestCount: current.pullRequestCount + canonical.pullRequestCount,
        releaseCount: current.releaseCount + canonical.releaseCount,
        lastActivityAt:
          current.lastActivityAt &&
          (!lastActivityAt || current.lastActivityAt > lastActivityAt)
            ? current.lastActivityAt
            : (lastActivityAt ?? current.lastActivityAt),
        dataAsOf:
          current.dataAsOf && current.dataAsOf > dataAsOf
            ? current.dataAsOf
            : dataAsOf,
      });
    }

    return [...byProgram.values()];
  }
}
