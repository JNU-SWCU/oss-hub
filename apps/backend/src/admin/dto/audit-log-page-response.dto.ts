import type { AuditLogPage } from '../../platform/audit-log-read.service';
import type {
  AuditCategoryCounts,
  AuditEntry,
} from '../../platform/audit-entry.types';

export class AuditLogPageResponseDto {
  declare readonly items: readonly AuditEntry[];
  declare readonly total: number;
  declare readonly page: number;
  declare readonly limit: number;
  declare readonly counts: AuditCategoryCounts;

  static from(page: AuditLogPage): AuditLogPageResponseDto {
    return {
      items: page.items,
      total: page.total,
      page: page.page,
      limit: page.limit,
      counts: page.counts,
    };
  }
}
