import { filterStaffDashboardPrograms } from './staff-dashboard-filters';
import type { ProgramListStatus, StaffDashboardProgramSummary } from './types';

const PAGE_SIZE = 20;

export interface StaffDashboardPageModel {
  readonly filteredPrograms: readonly StaffDashboardProgramSummary[];
  readonly pageItems: readonly StaffDashboardProgramSummary[];
  readonly safePage: number;
  readonly totalPages: number;
  readonly isEmptyCatalog: boolean;
  readonly isNoResults: boolean;
}

interface StaffDashboardPageModelInput {
  readonly programs: readonly StaffDashboardProgramSummary[];
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly page: number;
  readonly now: Date;
}

export function buildStaffDashboardPageModel({
  programs,
  search,
  status,
  page,
  now,
}: StaffDashboardPageModelInput): StaffDashboardPageModel {
  const filteredPrograms = filterStaffDashboardPrograms(
    programs,
    search,
    status,
    now,
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredPrograms.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  return {
    filteredPrograms,
    pageItems: filteredPrograms.slice(
      (safePage - 1) * PAGE_SIZE,
      safePage * PAGE_SIZE,
    ),
    safePage,
    totalPages,
    isEmptyCatalog: programs.length === 0,
    isNoResults: programs.length > 0 && filteredPrograms.length === 0,
  };
}
