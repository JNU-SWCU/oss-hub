import { IsIn } from 'class-validator';
import {
  ACTIVITY_GRANULARITIES,
  type ActivityGranularity,
} from '../program-activity-granularity';

export class ActivityTimelineQueryRequestDto {
  @IsIn(ACTIVITY_GRANULARITIES)
  readonly granularity: ActivityGranularity = 'MONTH';
}

export interface ActivityProgramResponseDto {
  readonly programId: string;
  readonly programName: string;
  readonly year: number;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
}

export interface ActivityPointResponseDto {
  readonly period: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface ActivityTimelineResponseDto {
  readonly programs: readonly ActivityProgramResponseDto[];
  readonly series: {
    readonly granularity: ActivityGranularity;
    readonly points: readonly ActivityPointResponseDto[];
  };
}
