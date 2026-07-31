import { apiClient } from '@/lib/api-client';
import type {
  DashboardApplicationMode,
  DashboardApplicationStatus,
  DashboardItem,
  DashboardMilestone,
  DashboardRepositoryInvitationStatus,
  DashboardRepositoryProvisionStatus,
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

function isRepositoryProvisionStatus(
  value: unknown,
): value is DashboardRepositoryProvisionStatus {
  return (
    value === 'NOT_STARTED' ||
    value === 'PENDING' ||
    value === 'PROCESSING' ||
    value === 'SUCCEEDED' ||
    value === 'FAILED_RETRYABLE' ||
    value === 'FAILED_FINAL'
  );
}

function isRepositoryInvitationStatus(
  value: unknown,
): value is DashboardRepositoryInvitationStatus {
  return (
    value === null ||
    value === 'PENDING' ||
    value === 'SUCCEEDED' ||
    value === 'FAILED_RETRYABLE' ||
    value === 'FAILED_FINAL'
  );
}

function isSafeGithubUrl(value: string, repositoryName: string): boolean {
  return value === `https://github.com/JNU-SWCU/${repositoryName}`;
}

function isRepository(
  value: unknown,
): value is NonNullable<DashboardItem['repository']> {
  if (!isRecord(value) || !isRepositoryProvisionStatus(value.provisionStatus)) {
    return false;
  }
  if (!isRepositoryInvitationStatus(value.invitationStatus)) return false;

  if (value.provisionStatus !== 'SUCCEEDED') {
    return (
      value.repositoryName === null &&
      value.invitationStatus === null &&
      value.githubUrl === null
    );
  }

  return (
    isNonEmptyString(value.repositoryName) &&
    isNonEmptyString(value.githubUrl) &&
    isSafeGithubUrl(value.githubUrl, value.repositoryName)
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
    isProgramPath(value.checklistUrl, programId, '/submissions') &&
    (value.repository === null || isRepository(value.repository)) &&
    (applicationStatus === 'APPROVED' || value.repository === null)
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
