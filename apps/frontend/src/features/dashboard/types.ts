export type DashboardApplicationMode = 'PERSONAL' | 'TEAM';
export type DashboardApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type DashboardSubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type DashboardRepositoryProvisionStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';
export type DashboardRepositoryInvitationStatus =
  'PENDING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | null;

export interface DashboardMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionStatus: DashboardSubmissionStatus;
}

export interface DashboardItem {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly applicationMode: DashboardApplicationMode;
  readonly displayName: string;
  readonly applicationStatus: DashboardApplicationStatus;
  readonly nextMilestone: DashboardMilestone | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
  readonly repository: {
    readonly repositoryName: string | null;
    readonly provisionStatus: DashboardRepositoryProvisionStatus;
    readonly invitationStatus: DashboardRepositoryInvitationStatus;
    readonly githubUrl: string | null;
  } | null;
}

export interface StudentDashboard {
  readonly items: readonly DashboardItem[];
}

export interface ApplicationDecisionNotice {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly decidedAt: string;
}

export type StudentDashboardStatus = 'loading' | 'success' | 'error';

/**
 * 대시보드에 띄울 대기 중(PENDING) 팀 초대 한 건. 원본 계약(`team-invitations/received`)에는
 * 이름이 없어 프로그램·팀 이름은 별도 조회로 채운다 — 조회에 실패하면 `null`로 남기고
 * 화면이 식별 가능한 대체 문구를 보여준다(ADR-007).
 */
export interface PendingTeamInviteView {
  readonly invitationId: string;
  readonly teamId: string;
  readonly programId: string;
  readonly programName: string | null;
  readonly teamName: string | null;
}
