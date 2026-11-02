import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from './error-code.error';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from './audit-log-error-code.error';
import {
  AuditLogRepository,
  type AuditLogPage,
  type AuditLogRecord,
  type AuditLogRecordInput,
} from './audit-log.repository';
import type { AuditLogListQuery } from './audit-log-query.types';
import type { AuditLogListResult } from './audit-log.repository';
import type { AuditLogMetadataEvidence } from './audit-log-metadata.config';
import {
  AuditLogReadService,
  type AuditTargetJoinMaps,
} from './audit-log-read.service';

type AuditLogRecordWriter = Parameters<AuditLogRepository['record']>[1];

export interface AuditLogListRequest {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page?: number;
  readonly limit?: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AuditLogRepository)
    private readonly repository: Pick<
      AuditLogRepository,
      | 'list'
      | 'record'
      | 'findProgramNames'
      | 'findRepositoryNames'
      | 'findApplicationProgramNames'
    >,
    private readonly reader: AuditLogReadService,
  ) {}

  listQueryFromRequest(request: AuditLogListRequest): AuditLogListQuery {
    return {
      ...(request.actor === undefined ? {} : { actor: request.actor }),
      ...(request.action === undefined ? {} : { action: request.action }),
      ...(request.from === undefined ? {} : { from: request.from }),
      ...(request.to === undefined ? {} : { to: request.to }),
      page: request.page ?? 1,
      limit: request.limit ?? 20,
    };
  }

  listFromRequest(request: AuditLogListRequest): Promise<AuditLogPage> {
    return this.list(this.listQueryFromRequest(request));
  }

  async list(query: AuditLogListQuery): Promise<AuditLogPage> {
    if (query.from && query.to && query.from > query.to) {
      throw new DomainException(
        AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.INVALID_DATE_RANGE],
      );
    }
    const result = await this.listRecords(query);
    return { ...result, page: query.page, limit: query.limit };
  }

  private async listRecords(
    query: AuditLogListQuery,
  ): Promise<AuditLogListResult> {
    const { rows, total } = await this.repository.list(query);
    const entries = rows.map((row) => ({
      row,
      evidence: this.reader.metadata(row),
    }));
    const idsWhere = (
      targetType: string,
      needsJoin: (evidence: AuditLogMetadataEvidence) => boolean,
    ): readonly string[] => [
      ...new Set(
        entries
          .filter(
            ({ row, evidence }) =>
              row.targetType === targetType && needsJoin(evidence),
          )
          .map(({ row }) => row.targetId),
      ),
    ];
    const programIds = idsWhere(
      'PROGRAM',
      (evidence) => evidence.legacy || !('programName' in evidence.metadata),
    );
    const repositoryIds = idsWhere(
      'REPOSITORY',
      (evidence) =>
        evidence.legacy || !('repositoryFullName' in evidence.metadata),
    );
    const applicationIds = idsWhere(
      'APPLICATION',
      (evidence) =>
        evidence.legacy ||
        (!('applicantGithubLogin' in evidence.metadata) &&
          !('programName' in evidence.metadata)),
    );
    const [programs, repositories, applications] = await Promise.all([
      programIds.length > 0 ? this.repository.findProgramNames(programIds) : [],
      repositoryIds.length > 0
        ? this.repository.findRepositoryNames(repositoryIds)
        : [],
      applicationIds.length > 0
        ? this.repository.findApplicationProgramNames(applicationIds)
        : [],
    ]);
    const joinMaps: AuditTargetJoinMaps = {
      programNameById: new Map(programs.map((row) => [row.id, row.name])),
      repositoryFullNameById: new Map(
        repositories.map((row) => [row.id, row.nameWithOwner]),
      ),
      applicationLabelById: new Map(
        applications.map((row) => [row.id, row.program.name]),
      ),
    };
    return {
      items: entries.map(({ row, evidence }) =>
        this.reader.record(row, evidence, joinMaps),
      ),
      total,
    };
  }

  async record(
    input: AuditLogRecordInput,
    writer?: AuditLogRecordWriter,
  ): Promise<AuditLogRecord> {
    const row = await this.repository.record(input, writer);
    return this.reader.record(row, this.reader.metadata(row), {
      programNameById: new Map(),
      repositoryFullNameById: new Map(),
      applicationLabelById: new Map(),
    });
  }
}
