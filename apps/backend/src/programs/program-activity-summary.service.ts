import { Inject, Injectable } from '@nestjs/common';
import { ProgramActivitySummaryRepository } from './program-activity.repository';

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
      'summarizePrograms'
    >,
  ) {}

  async summarize(
    programIds: readonly string[],
  ): Promise<readonly ProgramActivitySummary[]> {
    if (programIds.length === 0) return [];
    const rows = await this.repository.summarizePrograms(programIds);
    const byProgram = new Map(rows.map((row) => [row.programId, row]));
    return programIds.map((programId) => {
      const row = byProgram.get(programId);
      return {
        programId,
        repositoryCount: row?.repositoryCount ?? 0,
        commitCount: row?.commitCount ?? 0,
        pullRequestCount: row?.pullRequestCount ?? 0,
        releaseCount: row?.releaseCount ?? 0,
        lastActivityAt: row?.lastActivityAt?.toISOString() ?? null,
        dataAsOf: row?.dataAsOf?.toISOString() ?? null,
      };
    });
  }
}
