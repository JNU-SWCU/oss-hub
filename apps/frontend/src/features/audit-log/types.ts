export interface AuditLogRecord {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  // 사람이 읽을 수 있는 대상 라벨. schemaVersion 2 행은 대상의 GitHub 로그인,
  // 과거(v1·legacy) 행은 `targetType / targetId` 폴백이다.
  readonly target: string;
  readonly occurredAt: string;
}

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
