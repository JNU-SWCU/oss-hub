import type { ActivityGranularity } from './program-activity-granularity';
interface ActivityProgramResult {
  readonly programId: string;
  readonly programName: string;
  readonly year: number;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
}

export interface ActivityPointResult {
  readonly period: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly issueCount: number;
  readonly total: number;
}

export interface ActivityTimelineResult {
  readonly dataAsOf: Date | null;
  readonly programs: readonly ActivityProgramResult[];
  readonly series: {
    readonly granularity: ActivityGranularity;
    readonly points: readonly ActivityPointResult[];
  };
}
