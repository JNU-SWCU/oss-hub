import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from './error-code.error';
import { AUDIT_LOG_ERROR_CODES, AuditLogErrorCode } from './history.error';
import {
  AuditLogReadRepository,
  type AuditLogListQuery,
} from './audit-log-read.repository';
import type { AuditCategory, AuditSourceKey } from './audit-source.config';
import type { AuditCategoryCounts, AuditEntry } from './audit-entry.types';
import type { AuditSourceAdapterService } from './audit-source-adapter.service';
import { AccountAuditSourceService } from './account-audit-source.service';
import { TeamAuditSourceService } from './team-audit-source.service';
import { ProgramAuditSourceService } from './program-audit-source.service';
import { SubmissionAuditSourceService } from './submission-audit-source.service';
import { LoginAuditSourceService } from './login-audit-source.service';

export interface AuditLogListRequest {
  readonly q?: string;
  readonly action?: string;
  readonly category?: AuditCategory;
  readonly from?: string;
  readonly to?: string;
  readonly page?: number;
  readonly limit?: number;
}

export type AuditLogPage = {
  readonly items: readonly AuditEntry[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly counts: AuditCategoryCounts;
};

@Injectable()
export class AuditLogReadService {
  private readonly sources: Readonly<
    Record<AuditSourceKey, AuditSourceAdapterService>
  >;

  constructor(
    @Inject(AuditLogReadRepository)
    private readonly repository: Pick<AuditLogReadRepository, 'list'>,
    account: AccountAuditSourceService,
    team: TeamAuditSourceService,
    program: ProgramAuditSourceService,
    submission: SubmissionAuditSourceService,
    login: LoginAuditSourceService,
  ) {
    this.sources = {
      ACCOUNT: account,
      TEAM: team,
      PROGRAM: program,
      SUBMISSION: submission,
      LOGIN: login,
    };
  }

  listQueryFromRequest(request: AuditLogListRequest): AuditLogListQuery {
    return {
      ...(request.q === undefined ? {} : { q: request.q }),
      ...(request.action === undefined ? {} : { action: request.action }),
      ...(request.category === undefined ? {} : { category: request.category }),
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
    const { rows, total, counts } = await this.repository.list(query);
    return {
      items: rows.map((row) => this.sources[row.source].toAuditEntry(row)),
      total,
      page: query.page,
      limit: query.limit,
      counts,
    };
  }
}
