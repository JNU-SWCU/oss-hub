export type ActivityGranularity = 'MONTH' | 'YEAR';
export type ActivityApplicationMode = 'PERSONAL' | 'TEAM';

export interface ActivityProgram {
  readonly programId: string;
  readonly programName: string;
  readonly year: number;
  readonly applicationMode: ActivityApplicationMode;
}

export interface ActivityPoint {
  readonly period: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface ActivityTimeline {
  readonly programs: readonly ActivityProgram[];
  readonly series: {
    readonly granularity: ActivityGranularity;
    readonly points: readonly ActivityPoint[];
  };
}

export type ActivityTimelineStatus = 'loading' | 'success' | 'error';
