import { PrismaService } from '../platform/prisma.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import type { AdminAccessActor } from './admin-access-read.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import type {
  MemberKindRepositoryPort,
  MemberKindTransactionStore,
  MemberKindTargetRecord,
} from './member-kind.repository';
import { MemberKindService } from './member-kind.service';
import { MemberKindProfileService } from './member-kind-profile.service';
import { UserProfileService } from './user-profile.service';

export const ACTOR_GITHUB_ID = 9700500001n;
export const NOW = new Date('2026-01-01T00:00:00.000Z');

export function target(
  overrides: Partial<MemberKindTargetRecord> = {},
): MemberKindTargetRecord {
  return {
    id: 'target',
    githubId: 9700500002n,
    githubLogin: 'target-login',
    name: 'Target',
    selectedMemberKind: 'STUDENT',
    memberKind: 'STUDENT',
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    profileCreatedAt: NOW,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    profile: {
      name: 'Target',
      studentId: '123456',
      department: 'Department',
      staffNumber: null,
      memberKind: 'STUDENT',
      affiliationKind: 'DEPARTMENT',
      affiliationName: 'Department',
    },
    pendingRequest: null,
    ...overrides,
  };
}

export function staffTarget(
  overrides: Partial<MemberKindTargetRecord> = {},
): MemberKindTargetRecord {
  const base = target();
  if (!base.profile) throw new TypeError('The fixture requires a profile');
  return target({
    memberKind: 'STAFF',
    selectedMemberKind: 'STAFF',
    approvalStatus: 'APPROVED',
    profile: {
      ...base.profile,
      memberKind: 'STAFF',
      affiliationKind: 'PROGRAM_OFFICE',
    },
    ...overrides,
  });
}

class MemberKindStore
  implements MemberKindRepositoryPort, MemberKindTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor | null = {
    id: 'actor',
    githubId: ACTOR_GITHUB_ID,
    githubLogin: 'actor-login',
    name: 'Actor',
    memberKind: 'STUDENT',
    department: 'Department',
    profileCreatedAt: NOW,
    approvalStatus: 'NOT_REQUIRED',
    hasAdminAccess: true,
    accountStatus: 'ACTIVE',
  };
  target: MemberKindTargetRecord | null = target();
  writes = 0;
  failsUnique = false;
  failsCas = false;
  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
  lockActiveAdmins(): Promise<void> {
    return Promise.resolve();
  }
  findActorByGithubId(): Promise<AdminAccessActor | null> {
    return Promise.resolve(this.actor);
  }
  findTargetForUpdate(): Promise<MemberKindTargetRecord | null> {
    return Promise.resolve(this.target);
  }
  updateMemberKind: MemberKindTransactionStore['updateMemberKind'] = (
    before,
    _actorId,
    profile,
  ) => {
    if (this.failsUnique) return Promise.resolve('studentIdTaken');
    if (this.failsCas) return Promise.resolve('conflict');
    if (!before.profile) throw new TypeError('The fixture requires a profile');
    this.writes++;
    const approvalStatus =
      profile.memberKind === 'STAFF' ? 'APPROVED' : 'NOT_REQUIRED';
    const approvalRequestId =
      profile.memberKind === 'STAFF'
        ? before.approvalStatus === 'APPROVED'
          ? before.approvalRequestId
          : 'replacement-request'
        : null;
    this.target = {
      ...before,
      memberKind: profile.memberKind,
      selectedMemberKind: profile.memberKind,
      approvalStatus,
      approvalRequestId,
      pendingRequest: null,
      profile: { ...before.profile, ...profile },
    };
    return Promise.resolve({
      kind: 'updated',
      approvalStatus,
      approvalRequestId,
    });
  };
}

export function harness() {
  const store = new MemberKindStore();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const profile = new UserProfileService();
  const service = new MemberKindService(
    store,
    audit,
    new AuditLogMetadataService(),
    profile,
    new AdminAccessMutationService(new AuditLogMetadataService(), profile),
    new MemberKindProfileService(profile),
  );
  return { store, audit, service };
}
