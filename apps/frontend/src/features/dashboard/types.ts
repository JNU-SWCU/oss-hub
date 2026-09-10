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
  readonly coverImageUrl?: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  /**
   * **지금** 소속된 팀의 이름. 1인 팀도 팀이라 이 값은 항상 있다 — 서버가 개인형이라는
   * 개념 대신 팀 하나로 통일했고(#1269), 나갔거나 빠진 팀은 응답에 담기지 않는다.
   * 그래서 화면은 "개인/팀"을 나누거나 사람 이름을 대신 그리지 않는다.
   */
  readonly teamName: string;
  /** 그 팀의 화면(`/programs/{programId}/my-team`). 서버가 만든 값을 그대로 쓴다. */
  readonly teamUrl: string;
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
