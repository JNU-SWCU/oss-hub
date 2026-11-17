import type {
  StaffDashboardProgramSummary,
  StaffDashboardStatusSummary,
  StaffDashboardSummary,
} from './dto';

export interface StaffDashboardPageModel {
  readonly statusSummary: StaffDashboardStatusSummary;
  readonly pageItems: readonly StaffDashboardProgramSummary[];
  readonly total: number;
  readonly safePage: number;
  readonly totalPages: number;
  readonly isEmptyCatalog: boolean;
  readonly isNoResults: boolean;
}

export function buildStaffDashboardPageModel(
  summary: StaffDashboardSummary,
): StaffDashboardPageModel {
  return {
    statusSummary: summary.statusSummary,
    pageItems: summary.programs,
    total: summary.total,
    safePage: summary.page,
    totalPages: Math.max(1, Math.ceil(summary.total / summary.pageSize)),
    isEmptyCatalog: summary.catalogTotal === 0,
    isNoResults: summary.catalogTotal > 0 && summary.total === 0,
  };
}
