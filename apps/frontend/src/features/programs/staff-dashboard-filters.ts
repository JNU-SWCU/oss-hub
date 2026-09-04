import { staffTrackTypeLabel } from './staff-dashboard-format';
import { getStaffProgramRecruitmentState } from './staff-dashboard-status';
import {
  PROGRAM_LIST_STATUSES,
  type ProgramListStatus,
  type StaffDashboardProgramSummary,
} from './types';

export function parseStaffDashboardStatus(value: string): ProgramListStatus {
  return (PROGRAM_LIST_STATUSES as readonly string[]).includes(value)
    ? (value as ProgramListStatus)
    : 'all';
}

export function filterStaffDashboardPrograms(
  programs: readonly StaffDashboardProgramSummary[],
  search: string,
  status: ProgramListStatus,
  now: Date,
): readonly StaffDashboardProgramSummary[] {
  const needle = search.trim().toLowerCase();
  return programs.filter((program) => {
    const recruitmentState = getStaffProgramRecruitmentState(program, now);
    if (status !== 'all' && recruitmentState !== status) return false;
    if (!needle) return true;
    return (
      program.name.toLowerCase().includes(needle) ||
      (staffTrackTypeLabel(program.trackType) ?? '')
        .toLowerCase()
        .includes(needle)
    );
  });
}
