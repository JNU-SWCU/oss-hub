import {
  PROGRAM_LIST_STATUSES,
  type ProgramListStatus,
} from '../catalog/program-list-options';

export function parseStaffDashboardStatus(value: string): ProgramListStatus {
  return (PROGRAM_LIST_STATUSES as readonly string[]).includes(value)
    ? (value as ProgramListStatus)
    : 'all';
}
