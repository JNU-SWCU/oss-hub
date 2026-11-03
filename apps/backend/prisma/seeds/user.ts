import { createHash, randomUUID } from 'node:crypto';
import {
  AccountStatus,
  type ApprovalStatus,
  type DepartmentType,
  type Prisma,
  type User,
  type UserType,
} from '@prisma/client';
import { CONSENT_POLICY_VERSION } from '../../src/users/consents.service';
import {
  prisma,
  seedGithubId,
  seedNow,
  type SeedStats,
  upsertTracked,
} from './helpers';

export type SeedRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export async function setSeedAdmin(
  transaction: Prisma.TransactionClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const existing = await transaction.admin.findUnique({ where: { userId } });
  if ((existing !== null) === enabled) return;
  const now = seedNow();
  if (enabled) {
    await transaction.admin.create({
      data: { userId, origin: 'BOOTSTRAP', grantedAt: now },
    });
  } else {
    await transaction.admin.delete({ where: { userId } });
  }
  await transaction.adminHistory.create({
    data: {
      id: `seed:admin-history:${randomUUID()}`,
      userId,
      event: enabled ? 'GRANTED' : 'REVOKED',
      source: 'BOOTSTRAP',
      occurredAt: now,
      data: {
        schemaVersion: 1,
        recordKind: 'BOOTSTRAP',
        operatorReceipt: 'explicit seed initialization',
      },
    },
  });
}

export async function upsertSeedUser(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly role: SeedRole | null;
    readonly accountStatus?: AccountStatus;
  },
): Promise<User> {
  const { id, role, accountStatus = AccountStatus.ACTIVE } = params;
  const existing = await prisma.user.findUnique({ where: { id } });
  const profileType = existing?.profileCreatedAt ? existing.type : 'UNSELECTED';
  const types = {
    STUDENT: 'STUDENT',
    STAFF: 'STAFF',
    ADMIN: profileType,
  } as const;
  const type = role === null ? profileType : types[role];
  const approvals: Record<UserType, ApprovalStatus> = {
    UNSELECTED: 'NOT_REQUIRED',
    STUDENT: 'NOT_REQUIRED',
    STAFF: role === 'STAFF' ? 'APPROVED' : 'PENDING',
  };
  const write = {
    nickname: id.replace(/^seed:/, 'seed-').replace(/:/g, '-'),
    accountStatus,
    type,
    approvalStatus: approvals[type],
    studentId: type === 'STUDENT' ? (existing?.studentId ?? null) : null,
    approvalRequestId: null,
    approvalRequestedAt: null,
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
  };
  return upsertTracked(
    stats,
    'User',
    () => Promise.resolve(existing),
    () =>
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.upsert({
          where: { id },
          update: write,
          create: { id, githubId: seedGithubId(id), ...write },
        });
        await setSeedAdmin(transaction, id, role === 'ADMIN');
        return user;
      }),
  );
}

export async function upsertConsent(
  stats: SeedStats,
  userId: string,
): Promise<void> {
  const where = {
    userId_policyVersion: { userId, policyVersion: CONSENT_POLICY_VERSION },
  };
  await upsertTracked(
    stats,
    'UserPolicy',
    () => prisma.userPolicy.findUnique({ where }),
    () =>
      prisma.userPolicy.upsert({
        where,
        update: {},
        create: { userId, policyVersion: CONSENT_POLICY_VERSION },
      }),
  );
}

export async function upsertSeedProfile(params: {
  readonly userId: string;
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly type: 'STUDENT' | 'STAFF';
  readonly departmentType?: DepartmentType;
}): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
  });
  const staffApprovals: Record<ApprovalStatus, ApprovalStatus> = {
    NOT_REQUIRED: 'PENDING',
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    REVOKED: 'REVOKED',
  };
  const approvals = {
    STUDENT: 'NOT_REQUIRED',
    STAFF: staffApprovals[user.approvalStatus],
  } as const;
  const departments = {
    STUDENT: 'DEPARTMENT',
    STAFF: 'PROGRAM_OFFICE',
  } as const;
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      name: params.name,
      studentId: params.type === 'STUDENT' ? params.studentId : null,
      department: params.department,
      type: params.type,
      departmentType: params.departmentType ?? departments[params.type],
      approvalStatus: approvals[params.type],
      profileCreatedAt: user.profileCreatedAt ?? seedNow(),
      profileUpdatedAt: seedNow(),
    },
  });
}

export async function upsertSeedRequest(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly userId: string;
    readonly status: Exclude<ApprovalStatus, 'NOT_REQUIRED'>;
    readonly createdAt: Date;
    readonly rejectionReason?: string;
    readonly decidedById?: string;
    readonly decidedAt?: Date;
  },
): Promise<void> {
  const original = {
    id: params.id,
    userId: params.userId,
    status: params.status,
    createdAt: params.createdAt.toISOString(),
    updatedAt: seedNow().toISOString(),
    rejectionReason: params.rejectionReason ?? null,
    decidedById: params.decidedById ?? null,
    decidedAt: params.decidedAt?.toISOString() ?? null,
  };
  const part = createHash('sha256')
    .update(JSON.stringify(original))
    .digest('hex');
  const id = `${params.id}:snapshot:${part}`;
  await upsertTracked(
    stats,
    'UserHistory',
    () => prisma.userHistory.findUnique({ where: { id } }),
    () =>
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: params.userId },
        });
        const qualified = user.approvalStatus === 'APPROVED';
        const decisionMatches = qualified === (params.status === 'APPROVED');
        await transaction.user.update({
          where: { id: params.userId },
          data: {
            type: 'STAFF',
            approvalStatus: qualified ? 'APPROVED' : params.status,
            approvalRequestId: params.id,
            approvalRequestedAt: params.createdAt,
            approvalDecidedAt: decisionMatches
              ? (params.decidedAt ?? null)
              : null,
            approvalDecidedById: decisionMatches
              ? (params.decidedById ?? null)
              : null,
            approvalReason: decisionMatches
              ? (params.rejectionReason ?? null)
              : null,
          },
        });
        return transaction.userHistory.createMany({
          data: [
            {
              id,
              userId: params.userId,
              actorId: params.decidedById ?? null,
              event: 'LEGACY_IMPORT',
              source: 'BOOTSTRAP',
              sourceTable: 'SeedRequest',
              sourceId: params.id,
              sourcePart: part,
              occurredAt: params.createdAt,
              recordedAt: seedNow(),
              data: {
                schemaVersion: 1,
                recordKind: 'REQUEST_SNAPSHOT',
                requestId: params.id,
                original,
              },
            },
          ],
          skipDuplicates: true,
        });
      }),
  );
}
