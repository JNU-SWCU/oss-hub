import { Injectable } from '@nestjs/common';
import type {
  AuditChange,
  AuditEntry,
  AuditJoinedUser,
  AuditMetadataEvidence,
  AuditPerson,
  AuditSourceRow,
  AuditTarget,
  AuditTeamMembership,
} from './audit-entry.types';

const STORED_METADATA_SCHEMA_VERSIONS: readonly unknown[] = [1, 2];
const PERSON_TARGET_TYPES: ReadonlySet<string> = new Set([
  'USER',
  'ROLE_REQUEST',
  'APPLICATION',
]);
const CHANGE_KEYS = [
  'memberKind',
  'role',
  'accountStatus',
  'requestStatus',
  'status',
  'lifecycle',
  'visibility',
] as const;

type AuditEntryParts = {
  readonly change?: AuditChange | null;
  readonly requestId?: string | null;
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
      actor: this.person(metadata?.actor, row.actor),
      target: this.target(row, metadata),
      change: parts.change === undefined ? this.change(metadata) : parts.change,
      requestId: parts.requestId ?? null,
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

  private person(
    snapshotValue: unknown,
    joined: AuditJoinedUser | null,
  ): AuditPerson | null {
    const snapshot = this.personSnapshot(snapshotValue);
    if (!snapshot && !joined) return null;
    return {
      id: joined?.id ?? null,
      name: snapshot?.displayName?.trim() || joined?.name?.trim() || null,
      login: snapshot?.githubLogin ?? joined?.login ?? null,
      role: joined?.role ?? null,
    };
  }

  private target(
    row: AuditSourceRow,
    metadata: AuditMetadataEvidence | null,
  ): AuditTarget {
    const isPersonTarget = PERSON_TARGET_TYPES.has(row.targetType);
    const person = isPersonTarget
      ? this.person(metadata?.target, row.subject)
      : null;
    const programName =
      this.nonEmptyString(metadata?.programName) ?? row.programName;
    const teamName = this.nonEmptyString(metadata?.teamName) ?? row.teamName;
    return {
      type: row.targetType,
      id: row.targetId,
      name: this.targetName(row, metadata, person, programName, teamName),
      login: isPersonTarget
        ? (this.personSnapshot(metadata?.target)?.githubLogin ??
          this.nonEmptyString(metadata?.applicantGithubLogin) ??
          row.subject?.login ??
          null)
        : null,
      role: person?.role ?? null,
      programName: row.targetType === 'PROGRAM' ? null : programName,
      teamName: row.targetType === 'TEAM' ? null : teamName,
    };
  }

  private targetName(
    row: AuditSourceRow,
    metadata: AuditMetadataEvidence | null,
    person: AuditPerson | null,
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
        return person?.name ?? null;
    }
  }

  private change(metadata: AuditMetadataEvidence | null): AuditChange | null {
    if (metadata === null) return null;
    if (metadata.recordKind === 'TYPE_SELECTION')
      return this.changePair(metadata.before, metadata.after);
    const previousName = this.nonEmptyString(metadata.previousName);
    const teamName = this.nonEmptyString(metadata.teamName);
    if (previousName && teamName)
      return { before: previousName, after: teamName };
    const { before, after } = metadata;
    if (!this.isObject(before) || !this.isObject(after)) return null;
    for (const key of CHANGE_KEYS) {
      if (before[key] === after[key]) continue;
      const pair = this.changePair(before[key], after[key]);
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

  private changePair(before: unknown, after: unknown): AuditChange | null {
    const pair = {
      before: typeof before === 'string' ? before : null,
      after: typeof after === 'string' ? after : null,
    };
    return pair.before === null && pair.after === null ? null : pair;
  }

  private personSnapshot(value: unknown): {
    readonly displayName: string | null;
    readonly githubLogin: string;
  } | null {
    if (!this.isObject(value)) return null;
    const githubLogin = this.nonEmptyString(value.githubLogin);
    if (githubLogin === null) return null;
    if (value.displayName !== null && typeof value.displayName !== 'string')
      return null;
    return { displayName: value.displayName, githubLogin };
  }
}
