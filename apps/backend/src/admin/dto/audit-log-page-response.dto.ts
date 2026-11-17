import type {
  AuditLogPage,
  AuditLogRecord,
} from '../../platform/audit-log-read.service';

class AuditLogRecordResponseDto {
  declare readonly id: string;
  declare readonly actor: string;
  declare readonly actorHandle: string | null;
  declare readonly action: string;
  declare readonly targetType: string;
  declare readonly targetId: string;
  declare readonly target: string;
  declare readonly targetHandle: string | null;
  declare readonly occurredAt: string;
  declare readonly legacy: boolean;
  declare readonly metadata: Readonly<Record<string, unknown>> | null;

  static from(record: AuditLogRecord): AuditLogRecordResponseDto {
    return {
      id: record.id,
      actor: record.actor,
      actorHandle: record.actorHandle,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      target: record.target,
      targetHandle: record.targetHandle,
      occurredAt: record.occurredAt.toISOString(),
      legacy: record.legacy,
      metadata: record.metadata,
    };
  }
}

export class AuditLogPageResponseDto {
  declare readonly items: AuditLogRecordResponseDto[];
  declare readonly total: number;
  declare readonly page: number;
  declare readonly limit: number;

  static from(page: AuditLogPage): AuditLogPageResponseDto {
    return {
      items: page.items.map((record) => AuditLogRecordResponseDto.from(record)),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }
}
