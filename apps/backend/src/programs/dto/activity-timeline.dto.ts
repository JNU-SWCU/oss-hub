import type { ActivityTimelineResult } from '../activity-timeline.types';
import { type ActivityGranularity } from '../program-activity-granularity.policy';

interface ActivityProgramResponseDto {
  readonly programId: string;
  readonly programName: string;
  readonly year: number;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
}

interface ActivityPointResponseDto {
  readonly period: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly issueCount: number;
  readonly total: number;
}

export interface ActivityTimelineResponseDto {
  readonly dataAsOf: string | null;
  readonly programs: readonly ActivityProgramResponseDto[];
  readonly series: {
    readonly granularity: ActivityGranularity;
    readonly points: readonly ActivityPointResponseDto[];
  };
}

export function activityTimelineResponse(
  result: ActivityTimelineResult,
): ActivityTimelineResponseDto {
  return {
    dataAsOf: result.dataAsOf?.toISOString() ?? null,
    programs: result.programs.map((program) => ({
      programId: program.programId,
      programName: program.programName,
      year: program.year,
      applicationMode: program.applicationMode,
    })),
    series: {
      granularity: result.series.granularity,
      points: result.series.points.map((point) => ({
        period: point.period,
        commitCount: point.commitCount,
        pullRequestCount: point.pullRequestCount,
        releaseCount: point.releaseCount,
        issueCount: point.issueCount,
        total: point.total,
      })),
    },
  };
}
