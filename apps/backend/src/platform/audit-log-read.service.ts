import { Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import { StaffAccessRequestStatus } from '../users/user-contract.config';
import type { AuditLogRecord, AuditLogRow } from './audit-log.repository';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  type AuditLogMetadataEvidence,
} from './audit-log-metadata.config';
import type { HistoryAuditMetadataView } from './audit-log-history-metadata.config';

export interface AuditTargetJoinMaps {
  readonly programNameById: ReadonlyMap<string, string>;
  readonly repositoryFullNameById: ReadonlyMap<string, string>;
  readonly applicationLabelById: ReadonlyMap<string, string>;
}

@Injectable()
export class AuditLogReadService {
  constructor(private readonly parser: AuditLogMetadataService) {}

  metadata(row: AuditLogRow): AuditLogMetadataEvidence {
    if (row.historyKind) {
      if (
        row.historyKind === 'BOOTSTRAP' &&
        row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.GRANT_ADMIN_ACCESS &&
        row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.REVOKE_ADMIN_ACCESS
      )
        throw new InvalidAuditLogMetadataError();
      const history = parseHistoryMetadata(row.metadata, row.historyKind);
      if (!history) throw new InvalidAuditLogMetadataError();
      return { legacy: false, metadata: history };
    }
    try {
      return this.parser.parseAuditLogMetadata(row.metadata);
    } catch (error) {
      if (row.legacySource && error instanceof InvalidAuditLogMetadataError) {
        return { legacy: true, metadata: null };
      }
      throw error;
    }
  }

  record(
    log: AuditLogRow,
    evidence: AuditLogMetadataEvidence,
    joinMaps: AuditTargetJoinMaps,
  ): AuditLogRecord {
    const people = resolveAuditPeople(log, evidence);
    const base = {
      id: log.id,
      actor: people.actor,
      actorHandle: people.actorHandle,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      target: resolveAuditTargetLabel(log, evidence, joinMaps),
      targetHandle: people.targetHandle,
      occurredAt: log.occurredAt,
    };
    return evidence.legacy
      ? { ...base, legacy: true, metadata: null }
      : { ...base, legacy: false, metadata: evidence.metadata };
  }
}

function personLabel(snapshot: {
  readonly displayName: string | null;
  readonly githubLogin: string;
}): string {
  return snapshot.displayName?.trim() || snapshot.githubLogin;
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
      targetHandle: targetSnapshot?.githubLogin ?? null,
    };
  }
  return {
    actor: log.actor?.nickname ?? 'SYSTEM',
    actorHandle: log.actor?.nickname ?? null,
    targetHandle: null,
  };
}

function resolveAuditTargetLabel(
  log: AuditLogRow,
  evidence: AuditLogMetadataEvidence,
  joinMaps: AuditTargetJoinMaps,
): string {
  if (!evidence.legacy && 'target' in evidence.metadata) {
    return personLabel(evidence.metadata.target);
  }
  if (!evidence.legacy && 'applicantGithubLogin' in evidence.metadata) {
    return `${evidence.metadata.programName} · @${evidence.metadata.applicantGithubLogin}`;
  }
  if (
    !evidence.legacy &&
    'teamName' in evidence.metadata &&
    'programName' in evidence.metadata
  ) {
    return `${evidence.metadata.programName} · ${evidence.metadata.teamName}`;
  }
  if (!evidence.legacy && 'programName' in evidence.metadata)
    return evidence.metadata.programName;
  if (!evidence.legacy && 'repositoryFullName' in evidence.metadata)
    return evidence.metadata.repositoryFullName;
  const joined =
    log.targetType === 'PROGRAM'
      ? joinMaps.programNameById.get(log.targetId)
      : log.targetType === 'REPOSITORY'
        ? joinMaps.repositoryFullNameById.get(log.targetId)
        : log.targetType === 'APPLICATION'
          ? joinMaps.applicationLabelById.get(log.targetId)
          : undefined;
  return joined || `${log.targetType} / ${log.targetId}`;
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
