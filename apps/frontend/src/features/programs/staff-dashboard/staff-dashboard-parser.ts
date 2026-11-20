import { isRecord } from '@/lib/is-record';
import {
  PROGRAM_TRACK_TYPES,
  type ProgramTrackType,
} from '../program-contract';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardApplicationCounts,
  StaffDashboardMilestoneSummary,
  StaffDashboardProgramSummary,
  StaffDashboardSubmissionSummary,
  StaffDashboardSummary,
} from './dto';

export class StaffDashboardResponseError extends Error {
  constructor() {
    super('운영 대시보드 응답 형식이 올바르지 않습니다.');
    this.name = 'StaffDashboardResponseError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value);
}

function isProgramTrackType(value: unknown): value is ProgramTrackType | null {
  return (
    value === null ||
    PROGRAM_TRACK_TYPES.some((trackType) => trackType === value)
  );
}

function isSafeProgramId(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isApplications(
  value: unknown,
): value is StaffDashboardApplicationCounts {
  if (!isRecord(value)) return false;
  return (
    isCount(value.total) &&
    isCount(value.pendingApproval) &&
    isCount(value.approved) &&
    isCount(value.rejected) &&
    value.total === value.pendingApproval + value.approved + value.rejected
  );
}

function isActivity(value: unknown): value is StaffDashboardActivitySummary {
  return (
    isRecord(value) &&
    isCount(value.repositories) &&
    isCount(value.commits) &&
    isCount(value.pullRequests) &&
    isCount(value.releases) &&
    isNullableIsoDate(value.lastActivityAt) &&
    isNullableIsoDate(value.dataAsOf)
  );
}

function isSubmissions(
  value: unknown,
): value is StaffDashboardSubmissionSummary {
  if (!isRecord(value)) return false;
  const counts = [
    value.notSubmitted,
    value.submitted,
    value.approved,
    value.changesRequested,
    value.rejected,
  ];
  return (
    isCount(value.milestones) &&
    isCount(value.total) &&
    counts.every(isCount) &&
    value.total === counts.reduce((sum, count) => sum + count, 0)
  );
}

function isMilestone(value: unknown): value is StaffDashboardMilestoneSummary {
  if (!isRecord(value)) return false;
  const { submittedTeams, totalTeams } = value;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isIsoDate(value.startAt) &&
    isIsoDate(value.dueAt) &&
    ((submittedTeams === null && totalTeams === null) ||
      (isCount(submittedTeams) &&
        isCount(totalTeams) &&
        submittedTeams <= totalTeams))
  );
}

function isProgram(value: unknown): value is StaffDashboardProgramSummary {
  if (!isRecord(value) || !isSafeProgramId(value.id)) return false;
  if (!isRecord(value.applicationPeriod)) return false;
  return (
    isNonEmptyString(value.name) &&
    isProgramTrackType(value.trackType) &&
    isIsoDate(value.applicationPeriod.startsAt) &&
    isIsoDate(value.applicationPeriod.endsAt) &&
    Date.parse(value.applicationPeriod.startsAt) <=
      Date.parse(value.applicationPeriod.endsAt) &&
    isIsoDate(value.endAt) &&
    isApplications(value.applications) &&
    isActivity(value.activity) &&
    isSubmissions(value.submissions) &&
    Array.isArray(value.milestones) &&
    value.milestones.every(isMilestone)
  );
}

export function parseStaffDashboardSummary(
  value: unknown,
): StaffDashboardSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.programs) ||
    !value.programs.every(isProgram) ||
    !isCount(value.page) ||
    !isCount(value.pageSize) ||
    !isCount(value.total) ||
    !isCount(value.catalogTotal) ||
    !isRecord(value.statusSummary) ||
    !isCount(value.statusSummary.recruiting) ||
    !isCount(value.statusSummary.inProgress) ||
    !isCount(value.statusSummary.ended)
  ) {
    throw new StaffDashboardResponseError();
  }
  return {
    programs: value.programs,
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    catalogTotal: value.catalogTotal,
    statusSummary: {
      recruiting: value.statusSummary.recruiting,
      inProgress: value.statusSummary.inProgress,
      ended: value.statusSummary.ended,
    },
  };
}
