import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from './audit-log-error-code.enum';
import {
  AuditLogRepository,
  type AuditLogRecord,
  type AuditLogRecordInput,
  type AuditLogRepositoryPort,
  type AuditLogTransactionWriter,
} from './audit-log.repository';
import type { AuditLogListRequestDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AuditLogRepository)
    private readonly repository: AuditLogRepositoryPort,
  ) {}

  async list(
    actorGithubId: bigint,
    query: AuditLogListRequestDto,
  ): Promise<readonly AuditLogRecord[]> {
    const actor = await this.repository.findActorByGithubId(actorGithubId);
    if (
      actor?.role !== Role.ADMIN ||
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
    return this.repository.list(query);
  }

  record(
    input: AuditLogRecordInput,
    writer?: AuditLogTransactionWriter,
  ): Promise<AuditLogRecord> {
    return this.repository.record(input, writer);
  }
}
