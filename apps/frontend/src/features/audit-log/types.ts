export const AUDIT_LOG_CATEGORIES = [
  'ACCOUNT',
  'OPERATION',
  'SUBMISSION',
  'LOGIN',
  'SYSTEM',
] as const;

export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];

export const AUDIT_LOG_VIEWS = ['feed', 'table'] as const;

export type AuditLogViewMode = (typeof AUDIT_LOG_VIEWS)[number];

export interface AuditLogPerson {
  readonly id: string | null;
  readonly name: string | null;
  readonly login: string | null;
  readonly role: string | null;
}

export interface AuditLogTarget {
  readonly type: string;
  readonly id: string;
  readonly name: string | null;
  readonly login: string | null;
  readonly role: string | null;
  readonly programName: string | null;
  readonly teamName: string | null;
}

export type AuditLogChangeValue = string | boolean | null;

export interface AuditLogChange {
  readonly field: string;
  readonly before: AuditLogChangeValue;
  readonly after: AuditLogChangeValue;
}

export type TeamMembershipOperation = 'LEAVE' | 'REMOVE' | 'TRANSFER_LEADER';

export interface TeamMembershipChange {
  readonly operation: TeamMembershipOperation;
  readonly leaderChanged: boolean;
  readonly teamDeleted: boolean;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly category: AuditLogCategory;
  readonly actor: AuditLogPerson | null;
  readonly target: AuditLogTarget;
  readonly change: AuditLogChange | null;
  readonly requestId: string | null;
  readonly teamMembership: TeamMembershipChange | null;
  readonly phoneTransition: 'SET' | 'REPLACED' | null;
}

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
  STAFF_ROLE_REQUEST_APPROVED: '권한 요청 승인',
  STAFF_ROLE_REQUEST_REJECTED: '권한 요청 반려',
  STAFF_ROLE_REQUEST_REVOKED: '권한 회수',
  STAFF_ROLE_REQUEST_RESTORED: '권한 복구',
  USER_ROLE_CHANGED: '회원 유형 변경',
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
  APPLICATION_RESUBMITTED: '신청 재제출',
  APPLICATION_APPROVED: '신청 승인',
  APPLICATION_REJECTED: '신청 반려',
  APPLICATION_REVERTED: '검토 대기로',
  APPLICATION_REPOSITORY_URL_CHANGED: '저장소 주소 변경',
  USER_PROFILE_UPDATED: '프로필 수정',
  USER_PHONE_UPDATED: '전화번호 수정',
  SUBMISSION_SUBMITTED: '서류 제출',
  SUBMISSION_RESUBMITTED: '서류 재제출',
  SUBMISSION_CHANGES_REQUESTED: '서류 수정 요청',
  SUBMISSION_APPROVED: '서류 승인',
  SUBMISSION_REJECTED: '서류 반려',
  LOGIN: '로그인',
  LOGIN_FAILED: '로그인 실패',
  LOGOUT: '로그아웃',
} as const satisfies Readonly<Record<string, string>>;

export type AuditLogAction = keyof typeof AUDIT_LOG_ACTION_LABELS;

export const AUDIT_LOG_ACTIONS = Object.keys(
  AUDIT_LOG_ACTION_LABELS,
) as readonly AuditLogAction[];

export interface AuditLogFilters {
  readonly q: string;
  readonly action: string;
  readonly from: string;
  readonly to: string;
}

export interface AuditLogListParams extends AuditLogFilters {
  readonly category: AuditLogCategory | '';
  readonly page: number;
  readonly limit: number;
}

export type AuditLogCategoryCounts = Readonly<Record<AuditLogCategory, number>>;

export interface AuditLogPage {
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly counts: AuditLogCategoryCounts;
}
