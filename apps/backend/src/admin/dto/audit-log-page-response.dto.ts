import type {
  AuditLogPage,
  AuditLogRecord,
} from '../../platform/audit-log.types';

export class AuditLogPageResponseDto {
  declare readonly items: readonly AuditLogRecord[];
  declare readonly total: number;
  declare readonly page: number;
  declare readonly limit: number;

  static from(page: AuditLogPage): AuditLogPageResponseDto {
    return { ...page };
  }
}
