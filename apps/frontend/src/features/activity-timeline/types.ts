export type ActivityGranularity = 'MONTH' | 'YEAR';

export interface ActivityProgram {
  programId: string;
  programName: string;
  year: number;
  applicationMode: string;
}

export interface ActivityPoint {
  period: string;
  commitCount: number;
  prCount: number;
  starCount: number;
  total: number;
}

export interface ActivityTimeline {
  programs: ActivityProgram[];
  series: {
    granularity: ActivityGranularity;
    points: ActivityPoint[];
  };
}

export type ActivityTimelineStatus = 'loading' | 'success' | 'error';
