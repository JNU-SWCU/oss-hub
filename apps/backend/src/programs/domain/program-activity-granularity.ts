export const ACTIVITY_GRANULARITIES = ['MONTH', 'YEAR'] as const;
export type ActivityGranularity = (typeof ACTIVITY_GRANULARITIES)[number];
