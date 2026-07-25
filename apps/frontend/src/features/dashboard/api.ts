import { apiClient } from '@/lib/api-client';
import type {
  DashboardApplicationMode,
  DashboardApplicationStatus,
  DashboardItem,
  DashboardMilestone,
  DashboardSubmissionStatus,
  StudentDashboard,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafePathSegment(value: string): boolean {
  return (
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isProgramPath(
  value: unknown,
  programId: string,
  suffix = '',
): value is string {
  return value === `/programs/${encodeURIComponent(programId)}${suffix}`;
}

function isApplicationMode(value: unknown): value is DashboardApplicationMode {
  return value === 'PERSONAL' || value === 'TEAM';
}

function isApplicationStatus(
  value: unknown,
): value is DashboardApplicationStatus {
  return value === 'SUBMITTED' || value === 'APPROVED' || value === 'REJECTED';
}

function isSubmissionStatus(
  value: unknown,
): value is DashboardSubmissionStatus {
  return (
    value === 'NOT_SUBMITTED' ||
    value === 'SUBMITTED' ||
    value === 'APPROVED' ||
    value === 'CHANGES_REQUESTED' ||
    value === 'REJECTED'
  );
}

function isMilestone(value: unknown): value is DashboardMilestone {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.dueAt) &&
    !Number.isNaN(Date.parse(value.dueAt)) &&
    isSubmissionStatus(value.submissionStatus)
  );
}

function isDashboardItem(value: unknown): value is DashboardItem {
  if (!isRecord(value)) return false;

  const applicationStatus = value.applicationStatus;
  const nextMilestone = value.nextMilestone;
  const programId = value.programId;

  return (
    isNonEmptyString(value.applicationId) &&
    isNonEmptyString(programId) &&
    isSafePathSegment(programId) &&
    isNonEmptyString(value.programName) &&
    isApplicationMode(value.applicationMode) &&
    isNonEmptyString(value.displayName) &&
    isApplicationStatus(applicationStatus) &&
    (nextMilestone === null || isMilestone(nextMilestone)) &&
    (applicationStatus === 'APPROVED' || nextMilestone === null) &&
    isProgramPath(value.detailUrl, programId) &&
    isProgramPath(value.checklistUrl, programId, '/submissions')
  );
}

function parseStudentDashboard(value: unknown): StudentDashboard {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isDashboardItem)
  ) {
    throw new Error('학생 대시보드 응답 형식이 올바르지 않습니다.');
  }

  return { items: value.items };
}

export async function fetchStudentDashboard(): Promise<StudentDashboard> {
  const response = await apiClient<unknown>('dashboard/student');
  return parseStudentDashboard(response);
}
