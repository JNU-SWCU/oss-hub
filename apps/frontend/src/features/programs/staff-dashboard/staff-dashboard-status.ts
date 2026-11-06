import {
  getProgramRecruitmentState,
  type ProgramRecruitmentState,
} from '../catalog/program-list';
import type { StaffDashboardProgramSummary } from './dto';

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
}

export function summarizeStaffDashboardStatuses(
  programs: readonly StaffDashboardProgramSummary[],
  now: Date,
): StaffDashboardStatusSummary {
  let recruiting = 0;
  let inProgress = 0;
  let ended = 0;

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
        break;
      case 'upcoming':
        break;
    }
  }

  return { recruiting, inProgress, ended };
}
