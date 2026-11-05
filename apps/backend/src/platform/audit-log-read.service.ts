import { Inject, Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { DomainException } from './error-code.error';
import { StaffAccessRequestStatus } from '../users/user-contract.config';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  type HistoryAuditMetadataView,
} from './history-metadata.config';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
  InvalidAuditLogMetadataError,
} from './history.error';
import {
  AuditLogReadRepository,
  type AuditLogListQuery,
  type AuditLogRow,
} from './audit-log-read.repository';

export interface AuditLogListRequest {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page?: number;
  readonly limit?: number;
}

type AuditLogMetadataEvidence = Readonly<Record<string, unknown>>;

type AuditLogRecordBase = {
  readonly id: string;
  readonly actor: string;
  readonly actorHandle: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly target: string;
  readonly targetHandle: string | null;
  readonly occurredAt: Date;
};

export type AuditLogRecord = AuditLogRecordBase &
  (
    | { readonly legacy: true; readonly metadata: null }
    | { readonly legacy: false; readonly metadata: AuditLogMetadataEvidence }
  );

export type AuditLogPage = {
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
};

type PersonSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};

const STORED_METADATA_SCHEMA_VERSIONS: readonly unknown[] = [1, 2];

@Injectable()
export class AuditLogReadService {
  constructor(
    @Inject(AuditLogReadRepository)
    private readonly repository: Pick<AuditLogReadRepository, 'list'>,
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
    const { rows, total } = await this.repository.list(query);
    return {
      items: rows.map(auditLogRecord),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

function auditLogRecord(row: AuditLogRow): AuditLogRecord {
  const metadata = recordMetadata(row);
  const people = resolveAuditPeople(row, metadata);
  const base = {
    id: row.id,
    actor: people.actor,
    actorHandle: people.actorHandle,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    target: resolveAuditTargetLabel(row, metadata),
    targetHandle: people.targetHandle,
    occurredAt: row.occurredAt,
  };
  return metadata === null
    ? { ...base, legacy: true, metadata: null }
    : { ...base, legacy: false, metadata };
}

function recordMetadata(row: AuditLogRow): AuditLogMetadataEvidence | null {
  if (row.historyKind) {
    if (
      row.historyKind === 'BOOTSTRAP' &&
      row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.GRANT_ADMIN_ACCESS &&
      row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.REVOKE_ADMIN_ACCESS
    )
      throw new InvalidAuditLogMetadataError();
    const history = parseHistoryMetadata(row.metadata, row.historyKind);
    if (!history) throw new InvalidAuditLogMetadataError();
    return history;
  }
  return storedMetadata(row);
}

function storedMetadata(row: AuditLogRow): AuditLogMetadataEvidence | null {
  const metadata = row.metadata;
  if (
    !isObject(metadata) ||
    'recordKind' in metadata ||
    !STORED_METADATA_SCHEMA_VERSIONS.includes(metadata.schemaVersion)
  )
    return null;
  if (
    row.action === 'USER_PHONE_UPDATED' &&
    metadata.transition !== 'SET' &&
    metadata.transition !== 'REPLACED'
  )
    return null;
  return metadata;
}

function personSnapshot(value: unknown): PersonSnapshot | null {
  if (!isObject(value) || !isNonEmptyString(value.githubLogin)) return null;
  if (value.displayName !== null && typeof value.displayName !== 'string')
    return null;
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}

function personLabel(snapshot: PersonSnapshot): string {
  return snapshot.displayName?.trim() || snapshot.githubLogin;
}

function resolveAuditPeople(
  row: AuditLogRow,
  metadata: AuditLogMetadataEvidence | null,
): {
  readonly actor: string;
  readonly actorHandle: string | null;
  readonly targetHandle: string | null;
} {
  const actorSnapshot = personSnapshot(metadata?.actor);
  if (actorSnapshot) {
    return {
      actor: personLabel(actorSnapshot),
      actorHandle: actorSnapshot.githubLogin,
      targetHandle: personSnapshot(metadata?.target)?.githubLogin ?? null,
    };
  }
  return {
    actor: row.actor?.nickname ?? 'SYSTEM',
    actorHandle: row.actor?.nickname ?? null,
    targetHandle: null,
  };
}

function resolveAuditTargetLabel(
  row: AuditLogRow,
  metadata: AuditLogMetadataEvidence | null,
): string {
  const targetSnapshot = personSnapshot(metadata?.target);
  if (targetSnapshot) return personLabel(targetSnapshot);
  const programName = nonEmptyStringOrNull(metadata?.programName);
  const applicantLogin = nonEmptyStringOrNull(metadata?.applicantGithubLogin);
  if (programName && applicantLogin)
    return `${programName} · @${applicantLogin}`;
  const teamName = nonEmptyStringOrNull(metadata?.teamName);
  if (programName && teamName) return `${programName} · ${teamName}`;
  return (
    programName ??
    nonEmptyStringOrNull(metadata?.repositoryFullName) ??
    (row.joinedTarget || `${row.targetType} / ${row.targetId}`)
  );
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseHistoryMetadata(
  value: unknown,
  recordKind: string,
): HistoryAuditMetadataView | null {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== recordKind
  )
    return null;
  switch (value.recordKind) {
    case 'SIGNUP':
    case 'BOOTSTRAP':
      return { schemaVersion: 1, recordKind: value.recordKind };
    case 'TYPE_SELECTION':
      if (!isUserType(value.before) || !isUserType(value.after)) return null;
      return {
        schemaVersion: 1,
        recordKind: 'TYPE_SELECTION',
        before: value.before,
        after: value.after,
      };
    case 'REQUEST_TRANSITION': {
      const request = value.request;
      if (!isObject(request) || typeof request.id !== 'string') return null;
      const status = requestStatus(request.status);
      if (status === null) return null;
      if (
        value.cause !== undefined &&
        value.cause !== 'SUPERSEDED' &&
        value.cause !== 'TYPE_CHANGED' &&
        value.cause !== 'ADMIN_TYPE_CHANGE'
      )
        return null;
      if (
        value.replacementRequestId !== undefined &&
        value.replacementRequestId !== null &&
        typeof value.replacementRequestId !== 'string'
      )
        return null;
      return {
        schemaVersion: 1,
        recordKind: 'REQUEST_TRANSITION',
        requestId: request.id,
        status,
        ...(value.cause === undefined ? {} : { cause: value.cause }),
        ...(value.replacementRequestId === undefined
          ? {}
          : { replacementRequestId: value.replacementRequestId }),
      };
    }
    default:
      return null;
  }
}

function requestStatus(value: unknown): StaffAccessRequestStatus | null {
  switch (value) {
    case StaffAccessRequestStatus.PENDING:
    case StaffAccessRequestStatus.APPROVED:
    case StaffAccessRequestStatus.REJECTED:
    case StaffAccessRequestStatus.REVOKED:
      return value;
    default:
      return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUserType(value: unknown): value is UserType {
  switch (value) {
    case UserType.UNSELECTED:
    case UserType.STUDENT:
    case UserType.STAFF:
      return true;
    default:
      return false;
  }
}
