import {
  getProgramRecruitmentState,
  type ProgramRecruitmentState,
} from './program-list';
import type { StaffDashboardProgramSummary } from './types';

export function getStaffProgramRecruitmentState(
  program: StaffDashboardProgramSummary,
  now: Date,
): ProgramRecruitmentState {
  return getProgramRecruitmentState(
    {
      id: program.id,
      name: program.name,
      organizer: '',
      trackType: program.trackType,
      lifecycle: program.lifecycle,
      applicationStartAt: program.applicationPeriod.startsAt,
      applicationEndAt: program.applicationPeriod.endsAt,
      endAt: program.endAt,
      description: '',
    },
    now,
  );
}

export interface StaffDashboardStatusSummary {
  readonly recruiting: number;
  readonly inProgress: number;
  readonly ended: number;

  readonly archived: number;
}

export function summarizeStaffDashboardStatuses(
  programs: readonly StaffDashboardProgramSummary[],
  now: Date,
): StaffDashboardStatusSummary {
  let recruiting = 0;
  let inProgress = 0;
  let ended = 0;
  let archived = 0;

  for (const program of programs) {
    switch (getStaffProgramRecruitmentState(program, now)) {
      case 'recruiting':
        recruiting += 1;
        break;
      case 'in_progress':
        inProgress += 1;
        break;
      case 'ended':
        ended += 1;

        if (program.lifecycle === 'ARCHIVED') archived += 1;
        break;
      case 'upcoming':
        break;
    }
  }

  return { recruiting, inProgress, ended, archived };
}
