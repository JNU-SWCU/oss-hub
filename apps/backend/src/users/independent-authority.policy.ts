import { MemberKind } from '@prisma/client';
import { authorityLabel, type AuthorityLabel } from './authority-label.policy';
import {
  createIndependentAuthorityAuditMetadata,
  type AuditPersonSnapshot,
  type IndependentAuthorityAuditAction,
  type IndependentAuthorityAuditMetadata,
  type IndependentAuthorityAuditState,
} from '../platform/audit-log-metadata.policy';
import type { AuditLogRecordInput } from '../platform/audit-log-record-input.types';
import type { AdminAccessActor } from './admin-access-repository.types';
import type {
  AdminAuthorityMutationCommand,
  IndependentAuthorityUserRecord,
  StaffAccessMutationCommand,
} from './independent-authority.types';

export const AUTHORITY_TARGETS = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type AuthorityTarget =
  (typeof AUTHORITY_TARGETS)[keyof typeof AUTHORITY_TARGETS];

export type IndependentAuthorityState = {
  readonly memberKind: MemberKind | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityTransition = IndependentAuthorityState & {
  readonly role: AuthorityLabel | null;
};

export function resolveIndependentAuthorityTransition(
  before: IndependentAuthorityState,
  target: AuthorityTarget,
  enabled: boolean,
): IndependentAuthorityTransition {
  const hasStaffAccess =
    target === AUTHORITY_TARGETS.STAFF ? enabled : before.hasStaffAccess;
  const hasAdminAccess =
    target === AUTHORITY_TARGETS.ADMIN ? enabled : before.hasAdminAccess;
  return {
    memberKind: before.memberKind,
    selectedMemberKind: before.memberKind ?? before.selectedMemberKind,
    hasStaffAccess,
    hasAdminAccess,
    role: authorityLabel({
      memberKind: before.memberKind,
      hasStaffAccess,
      hasAdminAccess,
    }),
  };
}

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
