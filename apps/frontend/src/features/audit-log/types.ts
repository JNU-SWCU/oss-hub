export interface AuditLogRecord {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  // 사람이 읽을 수 있는 대상 라벨. ACCESS_AUDIT schemaVersion 2 행은 대상의 GitHub
  // 로그인, PROGRAM_LIFECYCLE schemaVersion 2 행은 프로그램 이름 스냅샷, 스냅샷이
  // 없는 PROGRAM 대상 행은 백엔드가 join으로 찾은 현재 이름이다. 그 밖(과거
  // v1·legacy 행, REPOSITORY_PUBLISHED처럼 스냅샷이 없는 종류, join도 실패한 경우)은
  // `targetType / targetId` 폴백이다. 백엔드가 이벤트 시점 스냅샷·join으로 이미 계산해
  // 내려주는 라벨이며, 화면은 이 필드만 쓰고 raw metadata는 파싱 단계에서 버린다
  // (parser.ts).
  readonly target: string;
  readonly occurredAt: string;
}

// apps/backend/src/audit-log/audit-log-metadata.ts에 정의된 6개 action registry의
// 합집합을 미러링한다. 모노레포에 공유 패키지가 없어
// frontend가 backend/src를 직접 import할 수 없다(apps/frontend/src/features/roles의
// "Mirrors" 관례와 동일). 이 목록이 backend 정의와 어긋나지 않는지는
// action-registry.test.ts가 backend 소스를 텍스트로 읽어 검증한다 — 백엔드에 action을
// 추가/변경하면 이 목록도 함께 갱신해야 한다.
export const AUDIT_LOG_ACTION_LABELS = {
  STAFF_ROLE_REQUEST_APPROVED: '승인',
  STAFF_ROLE_REQUEST_REJECTED: '반려',
  STAFF_ROLE_REQUEST_REVOKED: '회수',
  STAFF_ROLE_REQUEST_RESTORED: '복구',
  USER_ROLE_CHANGED: '역할 변경',
  USER_ACCOUNT_STATUS_CHANGED: '계정 상태 변경',
  REPOSITORY_PUBLISHED: '저장소 공개',
  PROGRAM_ARCHIVED: '프로그램 보관',
  PROGRAM_RESTORED: '프로그램 복구',
  COLLECTION_SYNC_TRIGGERED: '수집 실행',
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: '제출 파일 정리 재시도',
  APPLICATION_APPROVED: '신청 승인',
  APPLICATION_REJECTED: '신청 반려',
  APPLICATION_REVERTED: '신청 판정 취소',
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
