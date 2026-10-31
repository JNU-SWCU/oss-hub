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
}

export type TeamMembershipOperation = 'LEAVE' | 'REMOVE';

export interface TeamMembershipChangeSummary {
  readonly operation: TeamMembershipOperation;

  readonly leaderChanged: boolean;

  readonly teamDeleted: boolean;
}

export type UserPhoneAuditTransition = 'SET' | 'REPLACED';

export const AUDIT_LOG_ACTION_LABELS = {
  STAFF_ROLE_REQUEST_APPROVED: '승인',
  STAFF_ROLE_REQUEST_REJECTED: '반려',
  STAFF_ROLE_REQUEST_REVOKED: '회수',
  STAFF_ROLE_REQUEST_RESTORED: '복구',
  USER_ROLE_CHANGED: '역할 변경',
  USER_ACCOUNT_STATUS_CHANGED: '계정 상태 변경',
  REPOSITORY_PUBLISHED: '저장소 공개',
  REPOSITORY_CONNECTION_CHANGED: '저장소 연결 변경',
  PROGRAM_CREATED: '프로그램 생성',
  PROGRAM_ARCHIVED: '프로그램 보관',
  PROGRAM_RESTORED: '프로그램 복구',
  PROGRAM_DELETED: '프로그램 삭제',
  TEAM_CREATED: '팀 생성',
  TEAM_JOINED: '팀 합류',
  TEAM_RENAMED: '팀 이름 변경',
  TEAM_DELETED: '팀 삭제',
  TEAM_MEMBERSHIP_CHANGED: '팀 구성 변경',
  COLLECTION_SYNC_TRIGGERED: '수집 실행',
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: '제출 파일 정리 재시도',
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
