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
import type { AuditLogListResult, AuditLogRow } from './audit-log.repository';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import type { AuditLogMetadataEvidence } from './audit-log-metadata.config';

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
    private readonly auditLogMetadataService: AuditLogMetadataService,
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
    const evidenceByLog = rows.map((row) =>
      this.auditLogMetadataService.parseAuditLogMetadata(row.metadata),
    );
    const idsWhere = (
      targetType: string,
      needsJoin: (evidence: AuditLogMetadataEvidence) => boolean,
    ): readonly string[] => [
      ...new Set(
        rows
          .filter(
            (row, index) =>
              row.targetType === targetType && needsJoin(evidenceByLog[index]!),
          )
          .map((row) => row.targetId),
      ),
    ];
    const programIds = idsWhere(
      PROGRAM_TARGET_TYPE,
      (evidence) => !hasProgramNameSnapshot(evidence),
    );
    const repositoryIds = idsWhere(
      REPOSITORY_TARGET_TYPE,
      (evidence) => !hasRepositoryFullNameSnapshot(evidence),
    );
    const applicationIds = idsWhere(
      APPLICATION_TARGET_TYPE,
      (evidence) =>
        !hasApplicationDecisionSnapshot(evidence) &&
        !hasProgramNameSnapshot(evidence),
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
      items: rows.map((row, index) =>
        toAuditLogRecord(row, evidenceByLog[index]!, joinMaps),
      ),
      total,
    };
  }

  async record(
    input: AuditLogRecordInput,
    writer?: AuditLogRecordWriter,
  ): Promise<AuditLogRecord> {
    const row = await this.repository.record(input, writer);
    return toAuditLogRecord(
      row,
      this.auditLogMetadataService.parseAuditLogMetadata(row.metadata),
      {
        programNameById: new Map(),
        repositoryFullNameById: new Map(),
        applicationLabelById: new Map(),
      },
    );
  }
}

const PROGRAM_TARGET_TYPE = 'PROGRAM';
const REPOSITORY_TARGET_TYPE = 'REPOSITORY';
const APPLICATION_TARGET_TYPE = 'APPLICATION';

interface AuditTargetJoinMaps {
  readonly programNameById: ReadonlyMap<string, string>;
  readonly repositoryFullNameById: ReadonlyMap<string, string>;
  readonly applicationLabelById: ReadonlyMap<string, string>;
}

function hasProgramNameSnapshot(evidence: AuditLogMetadataEvidence): boolean {
  return !evidence.legacy && 'programName' in evidence.metadata;
}

function hasRepositoryFullNameSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'repositoryFullName' in evidence.metadata;
}

function hasApplicationDecisionSnapshot(
  evidence: AuditLogMetadataEvidence,
): boolean {
  return !evidence.legacy && 'applicantGithubLogin' in evidence.metadata;
}

function composeApplicationTargetLabel(
  programName: string,
  applicantGithubLogin: string,
): string {
  return `${programName} · @${applicantGithubLogin}`;
}

function composeTeamTargetLabel(programName: string, teamName: string): string {
  return `${programName} · ${teamName}`;
}

function personLabel(snapshot: {
  readonly displayName: string | null;
  readonly githubLogin: string;
}): string {
  const name = snapshot.displayName?.trim();
  return name ? name : snapshot.githubLogin;
}

function toAuditLogRecord(
  log: AuditLogRow,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): AuditLogRecord {
  const people = resolveAuditPeople(log, evidence);
  const target = resolveAuditTargetLabel(
    log.targetType,
    log.targetId,
    evidence,
    joinMaps,
  );
  if (evidence.legacy) {
    return {
      id: log.id,
      actor: people.actor,
      actorHandle: people.actorHandle,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      target,
      targetHandle: people.targetHandle,
      occurredAt: log.occurredAt,
      legacy: true,
      metadata: null,
    };
  }
  return {
    id: log.id,
    actor: people.actor,
    actorHandle: people.actorHandle,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    target,
    targetHandle: people.targetHandle,
    occurredAt: log.occurredAt,
    legacy: false,
    metadata: evidence.metadata,
  };
}

function resolveAuditPeople(
  log: AuditLogRow,
  evidence: AuditLogMetadataEvidence,
): {
  readonly actor: string;
  readonly actorHandle: string | null;
  readonly targetHandle: string | null;
} {
  if (!evidence.legacy && 'actor' in evidence.metadata) {
    const actorSnapshot = evidence.metadata.actor;
    const targetSnapshot =
      'target' in evidence.metadata ? evidence.metadata.target : null;
    return {
      actor: personLabel(actorSnapshot),
      actorHandle: actorSnapshot.githubLogin,
      targetHandle: targetSnapshot ? targetSnapshot.githubLogin : null,
    };
  }
  return {
    actor: log.actor.nickname,
    actorHandle: log.actor.nickname,
    targetHandle: null,
  };
}

function resolveAuditTargetLabel(
  targetType: string,
  targetId: string,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): string {
  if (!evidence.legacy && 'target' in evidence.metadata) {
    return personLabel(evidence.metadata.target);
  }
  if (!evidence.legacy && 'applicantGithubLogin' in evidence.metadata) {
    return composeApplicationTargetLabel(
      evidence.metadata.programName,
      evidence.metadata.applicantGithubLogin,
    );
  }
  if (
    !evidence.legacy &&
    'teamName' in evidence.metadata &&
    'programName' in evidence.metadata
  ) {
    return composeTeamTargetLabel(
      evidence.metadata.programName,
      evidence.metadata.teamName,
    );
  }
  if (!evidence.legacy && 'programName' in evidence.metadata) {
    return evidence.metadata.programName;
  }
  if (!evidence.legacy && 'repositoryFullName' in evidence.metadata) {
    return evidence.metadata.repositoryFullName;
  }
  if (targetType === PROGRAM_TARGET_TYPE) {
    const joinedName = joinMaps.programNameById.get(targetId);
    if (joinedName) {
      return joinedName;
    }
  }
  if (targetType === REPOSITORY_TARGET_TYPE) {
    const joinedName = joinMaps.repositoryFullNameById.get(targetId);
    if (joinedName) {
      return joinedName;
    }
  }
  if (targetType === APPLICATION_TARGET_TYPE) {
    const joinedLabel = joinMaps.applicationLabelById.get(targetId);
    if (joinedLabel) {
      return joinedLabel;
    }
  }
  return `${targetType} / ${targetId}`;
}
