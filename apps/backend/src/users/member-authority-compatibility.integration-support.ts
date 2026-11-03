import { requestHistory } from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import {
  DepartmentType,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AccountStatus } from '@prisma/client';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
export const compatibilityPrisma = new PrismaService();
export const compatibilityUsers = new UsersService(
  new UsersRepository(compatibilityPrisma, new UserTransitionRepository()),
  { requireCurrent: () => Promise.resolve(undefined) },
  new UserHistoryRepository(new UserTransitionRepository()),
  new AuditLogMetadataService(),
  new UserProfileService(),
);
export const compatibilityAccess = new AdminAccessService(
  new AdminAccessRepository(
    compatibilityPrisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(compatibilityPrisma),
    new UserTransitionRepository(),
  ),
  new UserHistoryRepository(new UserTransitionRepository()),
  new AdminAccessMutationService(
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
);
const TEST_PREFIX = 'test:task8:member-authority:';
let sequence = 0;
export async function createOnboardingUser(label: string, kind: MemberKind) {
  sequence += 1;
  return compatibilityPrisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: 9008000000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      type: kind,
      approvalStatus: kind === 'STAFF' ? 'PENDING' : 'NOT_REQUIRED',
    },
    select: { id: true, githubId: true },
  });
}
export async function completeStaff(label: string) {
  const user = await createOnboardingUser(label, MemberKind.STAFF);
  await compatibilityUsers.completeMyProfile(user.githubId, {
    name: '합성 교직원',
    departmentType: DepartmentType.DEPARTMENT,
    department: '소프트웨어공학과',
  });
  return user;
}
export async function createAdmin(label: string) {
  sequence += 1;
  return compatibilityPrisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: 9008000000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      admin: { create: { origin: 'BOOTSTRAP' } },
    },
    select: { id: true, githubId: true },
  });
}
export function pendingRequest(userId: string) {
  return requestHistory(compatibilityPrisma, userId)
    .then((rows) =>
      rows.filter((row) => row.status === StaffAccessRequestStatus.PENDING),
    )
    .then((rows) => {
      const row = rows[0];
      if (!row) throw new TypeError('Expected request history fixture');
      return row;
    });
}
export function storedMember(userId: string) {
  return compatibilityPrisma.user.findUniqueOrThrow({
    include: { admin: true },
    where: { id: userId },
  });
}
export const ACTIVE_ACCESS_STATE = {
  expectedAccountStatus: AccountStatus.ACTIVE,
  desiredAccountStatus: AccountStatus.ACTIVE,
} as const;
