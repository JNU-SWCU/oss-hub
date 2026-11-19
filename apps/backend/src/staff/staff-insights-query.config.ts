const INSIGHTS_YEAR_MIN = 2000;
const INSIGHTS_YEAR_MAX = 2100;

export const INSIGHTS_YEAR_ERROR = `year must be omitted, "all", or a calendar year between ${INSIGHTS_YEAR_MIN} and ${INSIGHTS_YEAR_MAX}`;

export const UNREGISTERED_DEPARTMENT = '미등록';

export const STAFF_INSIGHTS_PERIOD_LEADER_LIMIT = 10;
export const STAFF_INSIGHTS_RECENT_LEADER_LIMIT = 10;
export const STAFF_INSIGHTS_ATTENTION_STUDENT_LIMIT = 4;

export const STAFF_INSIGHTS_FINDER_SORTS = [
  'name',
  'studentId',
  'total',
  'recentTotal',
  'collaborationRatio',
] as const;
export const STAFF_INSIGHTS_FINDER_DIRECTIONS = ['asc', 'desc'] as const;
export const STAFF_INSIGHTS_RECENT_ACTIVITY = [
  'all',
  'active',
  'inactive',
] as const;

export interface StaffInsightsFinderQuery {
  readonly currentYear?: number;
  readonly search: string;
  readonly department?: string;
  readonly programId?: string;
  readonly minActivity: number;
  readonly recentActivity: (typeof STAFF_INSIGHTS_RECENT_ACTIVITY)[number];
  readonly sort: (typeof STAFF_INSIGHTS_FINDER_SORTS)[number];
  readonly direction: (typeof STAFF_INSIGHTS_FINDER_DIRECTIONS)[number];
  readonly page: number;
}

export type StaffInsightsFinderInput = Partial<
  Omit<StaffInsightsFinderQuery, 'currentYear'>
> & { readonly year?: string };
