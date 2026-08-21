import {
  createIndependentAuthorityAuditMetadata,
  type AuditPersonSnapshot,
  type IndependentAuthorityAuditAction,
  type IndependentAuthorityAuditMetadata,
  type IndependentAuthorityAuditState,
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

export type IndependentAuthorityAuditRecordInput = Omit<
  AuditLogRecordInput,
  'action' | 'metadata'
> & {
  readonly action: IndependentAuthorityAuditAction;
  readonly metadata: IndependentAuthorityAuditMetadata;
};

export function createIndependentAuthorityAudit(input: {
  readonly actorGithubId: bigint;
  readonly actor: AdminAccessActor;
  readonly before: IndependentAuthorityUserRecord;
  readonly after: IndependentAuthorityTransition;
  readonly command: IndependentAuthorityCommand;
}): IndependentAuthorityAuditRecordInput {
  const { actor, actorGithubId, before: target, after, command } = input;
  const action: IndependentAuthorityAuditAction = command.command;

  return {
    actorGithubId,
    action,
    targetType: 'USER',
    targetId: target.id,
    metadata: createIndependentAuthorityAuditMetadata({
      command: command.command,
      actor: personSnapshot(actor),
      target: personSnapshot(target),
      before: authorityState(target, target.accountStatus),
      after: authorityState(after, target.accountStatus),
    }),
  };
}

function personSnapshot(person: {
  readonly name: string | null;
  readonly githubLogin: string;
}): AuditPersonSnapshot {
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
): IndependentAuthorityAuditState {
  return {
    memberKind: authority.memberKind,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    role: authority.role,
    accountStatus,
  };
}
