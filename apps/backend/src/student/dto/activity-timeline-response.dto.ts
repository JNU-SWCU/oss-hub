import type { ActivityTimelineResult } from '../../programs/activity-timeline.types';
import { type ActivityGranularity } from '../../programs/program-activity-granularity.policy';

export class ActivityProgramResponseDto {
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly year: number;
  declare readonly applicationMode: 'PERSONAL' | 'TEAM';

  static from(
    program: ActivityTimelineResult['programs'][number],
  ): ActivityProgramResponseDto {
    return {
      programId: program.programId,
      programName: program.programName,
      year: program.year,
      applicationMode: program.applicationMode,
    };
  }
}

export class ActivityPointResponseDto {
  declare readonly period: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;
  declare readonly issueCount: number;
  declare readonly total: number;

  static from(
    point: ActivityTimelineResult['series']['points'][number],
  ): ActivityPointResponseDto {
    return {
      period: point.period,
      commitCount: point.commitCount,
      pullRequestCount: point.pullRequestCount,
      releaseCount: point.releaseCount,
      issueCount: point.issueCount,
      total: point.total,
    };
  }
}

export class ActivityTimelineResponseDto {
  declare readonly dataAsOf: string | null;
  declare readonly programs: readonly ActivityProgramResponseDto[];
  declare readonly series: {
    readonly granularity: ActivityGranularity;
    readonly points: readonly ActivityPointResponseDto[];
  };

  static from(result: ActivityTimelineResult): ActivityTimelineResponseDto {
    return {
      dataAsOf: result.dataAsOf?.toISOString() ?? null,
      programs: result.programs.map((program) =>
        ActivityProgramResponseDto.from(program),
      ),
      series: {
        granularity: result.series.granularity,
        points: result.series.points.map((point) =>
          ActivityPointResponseDto.from(point),
        ),
      },
    };
  }
}
