import { getProgramRecruitmentState } from './program-list';
import { STAFF_CATEGORY_LABELS } from './staff-dashboard-format';
import type { ProgramListStatus, StaffDashboardProgramSummary } from './types';

export function parseStaffDashboardStatus(value: string): ProgramListStatus {
  if (value === 'recruiting' || value === 'closed') return value;
  return 'all';
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
        category: program.category,
        applicationStartAt: program.applicationPeriod.startsAt,
        applicationEndAt: program.applicationPeriod.endsAt,
        description: '',
      },
      now,
    );
    if (status !== 'all' && recruitmentState !== status) return false;
    if (!needle) return true;
    return (
      program.name.toLowerCase().includes(needle) ||
      STAFF_CATEGORY_LABELS[program.category].toLowerCase().includes(needle)
    );
  });
}
