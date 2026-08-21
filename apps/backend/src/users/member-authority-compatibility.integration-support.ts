import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

export const compatibilityPrisma = new PrismaService();
export const compatibilityUsers = new UsersService(
  new UsersRepository(compatibilityPrisma),
  { requireCurrent: () => Promise.resolve(undefined) },
);
export const compatibilityAccess = new AdminAccessService(
  new AdminAccessRepository(compatibilityPrisma),
  new AuditLogService(new AuditLogRepository(compatibilityPrisma)),
);

const TEST_PREFIX = 'test:task8:member-authority:';
let sequence = 0;

export async function createOnboardingUser(label: string, kind: MemberKind) {
  sequence += 1;
  const role = kind === MemberKind.STUDENT ? Role.STUDENT : Role.STAFF;
  return compatibilityPrisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: 9_008_000_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      selectedRole: role,
      selectedMemberKind: kind,
    },
    select: { id: true, githubId: true },
  });
}

export async function completeStaff(label: string) {
  const user = await createOnboardingUser(label, MemberKind.STAFF);
  await compatibilityUsers.completeMyProfile(user.githubId, {
    name: '합성 교직원',
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '소프트웨어공학과',
  });
  return user;
}

export async function createAdmin(label: string) {
  sequence += 1;
  return compatibilityPrisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: 9_008_000_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      role: Role.ADMIN,
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
    select: { id: true, githubId: true },
  });
}

export function pendingRequest(userId: string) {
  return compatibilityPrisma.roleRequest.findFirstOrThrow({
    where: { userId, status: RoleRequestStatus.PENDING },
  });
}

export function storedMember(userId: string) {
  return compatibilityPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
}

export const ACTIVE_ACCESS_STATE = {
  expectedAccountStatus: AccountStatus.ACTIVE,
  desiredAccountStatus: AccountStatus.ACTIVE,
} as const;
