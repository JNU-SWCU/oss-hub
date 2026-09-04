import {
  PROGRAM_TRACK_TYPE_LABELS,
  PROGRAM_TRACK_TYPES,
  type ProgramTrackType,
} from './program-templates';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardApplicationCounts,
  StaffDashboardProgramSummary,
  StaffDashboardSubmissionSummary,
  StaffDashboardSummary,
} from './types';

export class StaffDashboardResponseError extends Error {
  constructor() {
    super('운영 대시보드 응답 형식이 올바르지 않습니다.');
    this.name = 'StaffDashboardResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function isProgramLifecycle(
  value: unknown,
): value is StaffDashboardProgramSummary['lifecycle'] {
  return value === 'PUBLISHED' || value === 'ARCHIVED';
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
    isCount(value.submitted) &&
    isCount(value.pendingApproval) &&
    isCount(value.approved) &&
    isCount(value.rejected) &&
    value.pendingApproval === value.submitted &&
    value.total === value.submitted + value.approved + value.rejected
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
    isCount(value.approvedApplications) &&
    isCount(value.milestones) &&
    isCount(value.total) &&
    counts.every(isCount) &&
    value.total === value.approvedApplications * value.milestones &&
    value.total === counts.reduce((sum, count) => sum + count, 0)
  );
}

function isProgram(value: unknown): value is StaffDashboardProgramSummary {
  if (!isRecord(value) || !isSafeProgramId(value.id)) return false;
  if (!isRecord(value.applicationPeriod)) return false;
  const expectedApplicantsPath = `/programs/${encodeURIComponent(value.id)}/applicants`;
  return (
    isNonEmptyString(value.name) &&
    isProgramTrackType(value.trackType) &&
    isIsoDate(value.applicationPeriod.startsAt) &&
    isIsoDate(value.applicationPeriod.endsAt) &&
    Date.parse(value.applicationPeriod.startsAt) <=
      Date.parse(value.applicationPeriod.endsAt) &&
    // 종료일·게시 축이 없으면 모집 상태를 공개 목록과 같게 판정할 수 없다(#1093).
    // 조용히 「안 내린 프로그램」으로 넘기지 않고 응답 형식 오류로 끊는다.
    isIsoDate(value.endAt) &&
    isProgramLifecycle(value.lifecycle) &&
    value.applicantsPath === expectedApplicantsPath &&
    isApplications(value.applications) &&
    isActivity(value.activity) &&
    isSubmissions(value.submissions)
  );
}

export function parseStaffDashboardSummary(
  value: unknown,
): StaffDashboardSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.programs) ||
    !value.programs.every(isProgram)
  ) {
    throw new StaffDashboardResponseError();
  }
  return { programs: value.programs };
}
