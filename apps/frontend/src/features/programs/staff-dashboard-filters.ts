import { getProgramRecruitmentState } from './program-list';
import { staffTrackTypeLabel } from './staff-dashboard-format';
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
    const recruitmentState = getProgramRecruitmentState(
      {
        id: program.id,
        name: program.name,
        organizer: '',
        trackType: program.trackType,
        applicationStartAt: program.applicationPeriod.startsAt,
        applicationEndAt: program.applicationPeriod.endsAt,
        endAt: null,
        description: '',
      },
      now,
    );
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
