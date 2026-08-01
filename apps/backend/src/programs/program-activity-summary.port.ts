export const PROGRAM_ACTIVITY_SUMMARY_PORT = Symbol(
  'PROGRAM_ACTIVITY_SUMMARY_PORT',
);

export interface ProgramActivitySummary {
  readonly programId: string;
  readonly repositoryCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface ProgramActivitySummaryPort {
  summarize(
    programIds: readonly string[],
  ): Promise<readonly ProgramActivitySummary[]>;
}
