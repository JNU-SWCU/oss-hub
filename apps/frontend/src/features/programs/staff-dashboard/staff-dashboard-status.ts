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
      organizers: [],
      trackType: program.trackType,
      applicationStartAt: program.applicationPeriod.startsAt,
      applicationEndAt: program.applicationPeriod.endsAt,
      endAt: program.endAt,
    },
    now,
  );
}
