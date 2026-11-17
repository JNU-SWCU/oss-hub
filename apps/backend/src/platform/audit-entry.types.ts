import type { AuditCategory, AuditSourceKey } from './audit-source.config';

export type AuditPerson = {
  readonly id: string | null;
  readonly name: string | null;
  readonly login: string | null;
  readonly role: string | null;
};

export type AuditTarget = {
  readonly type: string;
  readonly id: string;
  readonly name: string | null;
  readonly login: string | null;
  readonly role: string | null;
  readonly programName: string | null;
  readonly teamName: string | null;
};

export type AuditChange = {
  readonly before: string | null;
  readonly after: string | null;
};

export type AuditTeamMembership = {
  readonly operation: 'LEAVE' | 'REMOVE' | 'TRANSFER_LEADER';
  readonly leaderChanged: boolean;
  readonly teamDeleted: boolean;
};

export type AuditMetadataEvidence = Readonly<Record<string, unknown>>;

type AuditEntryBase = {
  readonly id: string;
  readonly occurredAt: Date;
  readonly action: string;
  readonly category: AuditCategory;
  readonly actor: AuditPerson | null;
  readonly target: AuditTarget;
  readonly change: AuditChange | null;
  readonly requestId: string | null;
  readonly teamMembership: AuditTeamMembership | null;
};

export type AuditEntry = AuditEntryBase &
  (
    | { readonly legacy: true; readonly metadata: null }
    | { readonly legacy: false; readonly metadata: AuditMetadataEvidence }
  );

export type AuditJoinedUser = {
  readonly id: string;
  readonly name: string | null;
  readonly login: string;
  readonly role: string;
};

export type AuditSourceRow = {
  readonly id: string;
  readonly source: AuditSourceKey;
  readonly occurredAt: Date;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: unknown;
  readonly historyKind: string | null;
  readonly category: AuditCategory;
  readonly actor: AuditJoinedUser | null;
  readonly subject: AuditJoinedUser | null;
  readonly programName: string | null;
  readonly teamName: string | null;
  readonly repositoryName: string | null;
};

export type AuditCategoryCounts = Readonly<Record<AuditCategory, number>>;
