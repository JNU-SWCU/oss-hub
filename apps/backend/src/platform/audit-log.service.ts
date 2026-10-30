import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DomainException } from './error-code.error';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from './audit-log-error-code.error';
import {
  AuditLogRepository,
  type AuditLogListResult,
  type AuditLogRecord,
} from './audit-log.repository';
import type { AuditLogRecordInput } from './audit-log-record-input.types';
import type { AuditLogListQuery } from './audit-log-query.types';

type AuditLogRecordWriter = Parameters<AuditLogRepository['record']>[1];

export type AuditLogPage = AuditLogListResult & {
  readonly page: number;
  readonly limit: number;
};

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AuditLogRepository)
    private readonly repository: Pick<
      AuditLogRepository,
      'findActorByGithubId' | 'list' | 'record'
    >,
  ) {}

  async list(
    actorGithubId: bigint,
    query: AuditLogListQuery,
  ): Promise<AuditLogPage> {
    const actor = await this.repository.findActorByGithubId(actorGithubId);
    if (
      actor?.hasAdminAccess !== true ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new DomainException(
        AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.ADMIN_ONLY],
      );
    }
    if (query.from && query.to && query.from > query.to) {
      throw new DomainException(
        AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.INVALID_DATE_RANGE],
      );
    }
    const result = await this.repository.list(query);
    return { ...result, page: query.page, limit: query.limit };
  }

  record(
    input: AuditLogRecordInput,
    writer?: AuditLogRecordWriter,
  ): Promise<AuditLogRecord> {
    return this.repository.record(input, writer);
  }
}
