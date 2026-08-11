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
  ApplicationDecisionNotice,
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repositoryName)) return false;
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    return (
      value === `https://github.com/JNU-SWCU/${repositoryName}` &&
      url.origin === 'https://github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      pathSegments.length === 2 &&
      pathSegments[0] === 'JNU-SWCU' &&
      pathSegments[1] === repositoryName
    );
  } catch {
    return false;
  }
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
    value.invitationStatus !== null &&
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
    // 서버(`programs/service/student-dashboard.service.ts`의 `detailUrlFor`)와 **한 벌**인
    // 규칙이다. `APPROVED`만 프로그램 상세로 가고 나머지(`SUBMITTED`·`REJECTED`)는 신청서
    // 화면으로 간다 — 반려 사유가 실려 오는 화면이 그곳뿐이기 때문이다(#733).
    // ⚠ 여기가 서버와 어긋나면 그 항목 하나만 빠지는 것이 아니다 — 아래 `parseStudentDashboard`
    // 가 `every` 로 보고 **던지고**, 화면은 카드 대신 오류와 재시도 버튼을 그린다. 반려 한 건
    // 때문에 승인된 프로그램과 마일스톤까지 전부 사라진다.
    isProgramPath(
      value.detailUrl,
      programId,
      applicationStatus === 'APPROVED' ? '' : '/apply',
    ) &&
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

function isApplicationDecisionNotice(
  value: unknown,
): value is ApplicationDecisionNotice {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.applicationId) &&
    isNonEmptyString(value.programId) &&
    isSafePathSegment(value.programId) &&
    isNonEmptyString(value.programName) &&
    (value.decision === 'APPROVED' || value.decision === 'REJECTED') &&
    isNonEmptyString(value.decidedAt) &&
    !Number.isNaN(Date.parse(value.decidedAt))
  );
}

export async function fetchUnreadApplicationDecisionNotices(): Promise<
  readonly ApplicationDecisionNotice[]
> {
  const response = await apiClient<unknown>(
    'users/me/notifications/application-decisions',
  );
  if (
    !Array.isArray(response) ||
    !response.every(isApplicationDecisionNotice)
  ) {
    throw new Error('신청 판정 알림 응답 형식이 올바르지 않습니다.');
  }
  return response;
}

export async function markApplicationDecisionNoticeRead(
  notificationId: string,
): Promise<void> {
  await apiClient<unknown>(
    `users/me/notifications/application-decisions/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' },
  );
}
