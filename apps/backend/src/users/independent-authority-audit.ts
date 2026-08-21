import {
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
  type AuditLogMetadata,
} from '../audit-log/audit-log-metadata';
import type { AuditLogRecordInput } from '../audit-log/audit-log.repository';
import type { AdminAccessActor } from './admin-access.repository.types';
import type {
  AdminAuthorityMutationCommand,
  StaffAccessMutationCommand,
} from './domain/independent-authority';
import type { IndependentAuthorityUserRecord } from './independent-authority.repository';
import type { IndependentAuthorityTransition } from './independent-authority-transition';

export type IndependentAuthorityCommand =
  StaffAccessMutationCommand | AdminAuthorityMutationCommand;

type AuthorityAuditState = {
  readonly memberKind: IndependentAuthorityUserRecord['memberKind'];
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly role: IndependentAuthorityUserRecord['role'];
  readonly accountStatus: IndependentAuthorityUserRecord['accountStatus'];
  readonly requestStatus: null;
};

type AuthorityAuditPersonSnapshot = Readonly<{
  displayName: string | null;
  githubLogin: string;
}>;

export function createIndependentAuthorityAudit(input: {
  readonly actorGithubId: bigint;
  readonly actor: AdminAccessActor;
  readonly before: IndependentAuthorityUserRecord;
  readonly after: IndependentAuthorityTransition;
  readonly command: IndependentAuthorityCommand;
}): AuditLogRecordInput {
  const target = input.before;
  const metadata = {
    schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
    eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
    command: input.command.command,
    actor: personSnapshot(input.actor),
    target: personSnapshot(target),
    before: authorityState(target, target.accountStatus),
    after: authorityState(input.after, target.accountStatus),
  } as const;
  const auditMetadata: AuditLogMetadata = metadata;
  return {
    actorGithubId: input.actorGithubId,
    action: input.command.command,
    targetType: 'USER',
    targetId: target.id,
    metadata: auditMetadata,
  };
}

function personSnapshot(person: {
  readonly name: string | null;
  readonly githubLogin: string;
}): AuthorityAuditPersonSnapshot {
  return {
    displayName: person.name,
    githubLogin: person.githubLogin,
  };
}

function authorityState(
  authority: Pick<
    IndependentAuthorityUserRecord,
    'memberKind' | 'hasStaffAccess' | 'hasAdminAccess' | 'role'
  >,
  accountStatus: IndependentAuthorityUserRecord['accountStatus'],
): AuthorityAuditState {
  return {
    memberKind: authority.memberKind,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    role: authority.role,
    accountStatus,
    requestStatus: null,
  };
}
