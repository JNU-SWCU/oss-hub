import { Injectable } from '@nestjs/common';
import type {
  AuditChange,
  AuditEntry,
  AuditMetadataEvidence,
  AuditSourceRow,
  AuditTarget,
  AuditTeamMembership,
} from './audit-entry.types';

const STORED_METADATA_SCHEMA_VERSIONS: readonly unknown[] = [1, 2];
const CHANGE_KEYS = [
  'memberKind',
  'role',
  'accountStatus',
  'requestStatus',
  'status',
  'lifecycle',
  'visibility',
  'hasStaffAccess',
  'hasAdminAccess',
] as const;
const ACTION_CHANGE_KEYS: Readonly<Record<string, string>> = {
  GRANT_STAFF_ACCESS: 'hasStaffAccess',
  REVOKE_STAFF_ACCESS: 'hasStaffAccess',
  GRANT_ADMIN_ACCESS: 'hasAdminAccess',
  REVOKE_ADMIN_ACCESS: 'hasAdminAccess',
};

type AuditEntryParts = {
  readonly change?: AuditChange | null;
  readonly teamMembership?: AuditTeamMembership | null;
};

@Injectable()
export abstract class AuditSourceAdapterService {
  abstract toAuditEntry(row: AuditSourceRow): AuditEntry;

  protected entry(
    row: AuditSourceRow,
    metadata: AuditMetadataEvidence | null,
    parts: AuditEntryParts = {},
  ): AuditEntry {
    const base = {
      id: row.id,
      occurredAt: row.occurredAt,
      action: row.action,
      category: row.category,
      actor: row.actor,
      target: this.target(row, metadata),
      change:
        parts.change === undefined
          ? this.change(row.action, metadata)
          : parts.change,
      requestId: row.requestId,
      teamMembership: parts.teamMembership ?? null,
    };
    return metadata === null
      ? { ...base, legacy: true, metadata: null }
      : { ...base, legacy: false, metadata };
  }

  protected storedMetadata(row: AuditSourceRow): AuditMetadataEvidence | null {
    const metadata = row.metadata;
    if (
      !this.isObject(metadata) ||
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

  private target(
    row: AuditSourceRow,
    metadata: AuditMetadataEvidence | null,
  ): AuditTarget {
    const person = row.targetPerson;
    const programName =
      this.nonEmptyString(metadata?.programName) ?? row.programName;
    const teamName = this.nonEmptyString(metadata?.teamName) ?? row.teamName;
    return {
      type: row.targetType,
      id: row.targetId,
      name: this.targetName(row, metadata, programName, teamName),
      login: person?.login ?? null,
      role: person?.role ?? null,
      programName: row.targetType === 'PROGRAM' ? null : programName,
      teamName: row.targetType === 'TEAM' ? null : teamName,
    };
  }

  private targetName(
    row: AuditSourceRow,
    metadata: AuditMetadataEvidence | null,
    programName: string | null,
    teamName: string | null,
  ): string | null {
    switch (row.targetType) {
      case 'PROGRAM':
        return programName;
      case 'TEAM':
        return teamName;
      case 'REPOSITORY':
        return (
          this.nonEmptyString(metadata?.repositoryFullName) ??
          row.repositoryName
        );
      case 'SUBMISSION':
        return this.nonEmptyString(metadata?.requirementName);
      default:
        return row.targetPerson?.name ?? null;
    }
  }

  private change(
    action: string,
    metadata: AuditMetadataEvidence | null,
  ): AuditChange | null {
    if (metadata === null) return null;
    if (metadata.recordKind === 'TYPE_SELECTION')
      return this.changePair('userType', metadata.before, metadata.after);
    const previousName = this.nonEmptyString(metadata.previousName);
    const teamName = this.nonEmptyString(metadata.teamName);
    if (previousName && teamName)
      return { field: 'teamName', before: previousName, after: teamName };
    const { before, after } = metadata;
    if (!this.isObject(before) || !this.isObject(after)) return null;
    const preferred = ACTION_CHANGE_KEYS[action];
    for (const key of preferred ? [preferred, ...CHANGE_KEYS] : CHANGE_KEYS) {
      if (before[key] === after[key]) continue;
      const pair = this.changePair(key, before[key], after[key]);
      if (pair) return pair;
    }
    return null;
  }

  protected nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  protected isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private changePair(
    field: string,
    before: unknown,
    after: unknown,
  ): AuditChange | null {
    const pair = {
      field,
      before: this.changeValue(before),
      after: this.changeValue(after),
    };
    return pair.before === null && pair.after === null ? null : pair;
  }

  private changeValue(value: unknown): string | boolean | null {
    return typeof value === 'string' || typeof value === 'boolean'
      ? value
      : null;
  }
}
