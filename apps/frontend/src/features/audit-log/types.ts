export interface AuditLogRecord {
  readonly id: string;
  readonly actor: string;

  readonly actorHandle?: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;

  readonly target: string;

  readonly targetHandle?: string | null;

  readonly teamMembership?: TeamMembershipChangeSummary;

  readonly teamPreviousName?: string;
  readonly occurredAt: string;
  readonly phoneTransition?: UserPhoneAuditTransition;
  readonly typeSelection?: {
    readonly before: AuditUserType;
    readonly after: AuditUserType;
  };
}

export type AuditUserType = 'UNSELECTED' | 'STUDENT' | 'STAFF';

export type TeamMembershipOperation = 'LEAVE' | 'REMOVE';

export interface TeamMembershipChangeSummary {
  readonly operation: TeamMembershipOperation;

  readonly leaderChanged: boolean;

  readonly teamDeleted: boolean;
}

export type UserPhoneAuditTransition = 'SET' | 'REPLACED';

export const AUDIT_LOG_ACTION_LABELS = {
  SIGNED_UP: '회원 가입',
  APPROVAL_REQUESTED: '교직원 승인 신청',
  REQUEST_SUPERSEDED: '이전 신청 종료',
  APPROVED: '교직원 승인',
  REVOKED: '교직원 승인 회수',
  GRANT_STAFF_ACCESS: '교직원 접근 허용',
  REVOKE_STAFF_ACCESS: '교직원 접근 회수',
  GRANT_ADMIN_ACCESS: '관리자 권한 부여',
  REVOKE_ADMIN_ACCESS: '관리자 권한 회수',
  STAFF_ROLE_REQUEST_APPROVED: '승인',
  STAFF_ROLE_REQUEST_REJECTED: '반려',
  STAFF_ROLE_REQUEST_REVOKED: '회수',
  STAFF_ROLE_REQUEST_RESTORED: '복구',
  USER_ROLE_CHANGED: '역할 변경',
  USER_ACCOUNT_STATUS_CHANGED: '계정 상태 변경',
  REPOSITORY_PUBLISHED: '저장소 공개',
  PROGRAM_CREATED: '프로그램 생성',
  PROGRAM_DELETED: '프로그램 삭제',
  TEAM_CREATED: '팀 생성',
  TEAM_JOINED: '팀 합류',
  TEAM_RENAMED: '팀 이름 변경',
  TEAM_DELETED: '팀 삭제',
  TEAM_MEMBERSHIP_CHANGED: '팀 구성 변경',
  APPLICATION_SUBMITTED: '신청 제출',
  APPLICATION_APPROVED: '신청 승인',
  APPLICATION_REJECTED: '신청 반려',
  APPLICATION_REVERTED: '검토 대기로',
  USER_PROFILE_UPDATED: '프로필 수정',
  USER_PHONE_UPDATED: '전화번호 수정',
} as const satisfies Readonly<Record<string, string>>;

export type AuditLogAction = keyof typeof AUDIT_LOG_ACTION_LABELS;

export const AUDIT_LOG_ACTIONS = Object.keys(
  AUDIT_LOG_ACTION_LABELS,
) as readonly AuditLogAction[];

export interface AuditLogFilters {
  readonly actor: string;
  readonly action: string;
  readonly from: string;
  readonly to: string;
}

export interface AuditLogListParams extends AuditLogFilters {
  readonly page: number;
  readonly limit: number;
}

export interface AuditLogPage {
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}
