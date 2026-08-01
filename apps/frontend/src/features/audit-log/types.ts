export interface AuditLogRecord {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
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
