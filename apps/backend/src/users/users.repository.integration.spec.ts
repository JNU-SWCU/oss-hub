import { userAuditRows } from './user-history.integration-fixture';

import { UserTransitionRepository } from './user-transition.repository';
import { DepartmentType, MemberKind } from './user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { UsersService } from './users.service';
import {
  UsersRepository,
  type ProfileCompletionOutcome,
  type UsersRepositoryPort,
} from './users.repository';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from './user-profile.service';
const userProfileService = new UserProfileService();
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const userId = 'test:users:profile';
const githubId = 9600000000153001n;
const otherUserId = 'test:users:profile:other';
const staffNumberSetUserId = 'test:users:profile:staff-number:set';
const staffNumberSetGithubId = 9600000000153201n;
const staffNumberReplaceUserId = 'test:users:profile:staff-number:replace';
const staffNumberReplaceGithubId = 9600000000153102n;
const staffNumberClearUserId = 'test:users:profile:staff-number:clear';
const staffNumberClearGithubId = 9600000000153103n;
const staffNumberOmittedUserId = 'test:users:profile:staff-number:omitted';
const staffNumberOmittedGithubId = 9600000000153104n;
const staffNumberNoopUserId = 'test:users:profile:staff-number:noop';
const staffNumberNoopGithubId = 9600000000153105n;
const firstProfile = {
  name: '합성 최초 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};
type StoredProfileFields = {
  readonly name: string;
  readonly studentId: string | null;
  readonly staffNumber: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly departmentType: DepartmentType;
};
type PhoneAuditCallback = Parameters<
  UsersRepositoryPort['completeProfileIfUnchanged']
>[2];
type StaffNumberAuditCallback = Parameters<
  UsersRepositoryPort['updateProfileFields']
>[2];
const prisma = new PrismaService();
const repository = new UsersRepository(prisma, new UserTransitionRepository());
const service = new UsersService(
  repository,
  { requireCurrent: () => Promise.resolve() },
  new UserHistoryRepository(new UserTransitionRepository()),
  new HistoryMetadataService(),
  new UserProfileService(),
);
const recordPhoneAudit = jest
  .fn<Promise<void>, Parameters<PhoneAuditCallback>>()
  .mockResolvedValue(undefined);
const recordStaffNumberAudit = jest
  .fn<Promise<void>, Parameters<StaffNumberAuditCallback>>()
  .mockResolvedValue(undefined);
async function completeProfileFor(
  profileGithubId: bigint,
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  },
  memberKind: MemberKind = MemberKind.STUDENT,
  departmentType: DepartmentType = DepartmentType.DEPARTMENT,
): Promise<ProfileCompletionOutcome> {
  const current = await repository.findByGithubId(profileGithubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  return repository.completeProfileIfUnchanged(
    current,
    canonicalCompletion(profile, memberKind, departmentType),
    recordPhoneAudit,
  );
}
async function completeCurrentProfile(
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  },
  memberKind: MemberKind = MemberKind.STUDENT,
  departmentType: DepartmentType = DepartmentType.DEPARTMENT,
): Promise<ProfileCompletionOutcome> {
  return completeProfileFor(githubId, profile, memberKind, departmentType);
}
async function currentStoredProfile(id: bigint) {
  const current = await repository.findByGithubId(id);
  if (!current) throw new TypeError('Expected current profile fixture');
  return current;
}
function readProfileRow(
  profileUserId = userId,
): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "staffNumber", "department",
           "type" AS "memberKind", "departmentType" AS "departmentType", "department" AS "department"
    FROM "User"
    WHERE "id" = ${profileUserId} AND "profileCreatedAt" IS NOT NULL
  `;
}
function readStaffNumberAudits(profileUserId: string) {
  return userAuditRows(prisma, {
    actorId: profileUserId,
    targetId: profileUserId,
    action: 'USER_PROFILE_UPDATED',
    field: 'staffNumber',
  }).then((rows) =>
    rows.map(({ action, targetId, metadata }) => ({
      action,
      targetId,
      metadata,
    })),
  );
}
async function createStaffNumberUser(
  profileUserId: string,
  profileGithubId: bigint,
): Promise<void> {
  await prisma.user.create({
    data: {
      id: profileUserId,
      githubId: profileGithubId,
      nickname: profileUserId,
      type: MemberKind.STAFF,
      approvalStatus: 'PENDING',
    },
  });
}
beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  recordPhoneAudit.mockClear();
  recordStaffNumberAudit.mockClear();
  await prisma.user.updateMany({
    where: { id: { in: [userId, otherUserId] } },
    data: {
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      phone: null,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
    },
  });
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
    update: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
  });
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: [userId, otherUserId] } },
    data: {
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      phone: null,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
    },
  });
  await prisma.$disconnect();
});
it('학번·학과를 User에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  const profileCreatedAt: unknown = expect.any(Date);
  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    profileCreatedAt,
    approvalRequestId: null,
    githubId,
    githubLogin: 'synthetic-profile-user',
    phone: null,
    staffNumber: null,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    departmentType: DepartmentType.DEPARTMENT,
    approvalStatus: 'NOT_REQUIRED',
    hasAdminAccess: false,
    hasPendingStaffRequest: false,
    ...firstProfile,
  });
});
it('학번 없는 교직원 프로필은 User 행으로 저장된다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: { type: MemberKind.STAFF, approvalStatus: 'PENDING' },
  });
  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 교직원',
      studentId: null,
      staffNumber: null,
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
    },
  ]);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    departmentType: DepartmentType.PROGRAM_OFFICE,
    studentId: null,
    department: '인공지능학부',
    approvalStatus: 'PENDING',
    hasAdminAccess: false,
    hasPendingStaffRequest: true,
  });
});
it('완료된 프로필의 이름·소속을 갱신할 수 있다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: { type: MemberKind.STAFF, approvalStatus: 'PENDING' },
  });
  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  await repository.updateProfileFields(
    await currentStoredProfile(githubId),
    {
      name: '합성 수정 교직원',
      department: '소프트웨어공학과',
      departmentType: DepartmentType.PROGRAM_OFFICE,
    },
    recordStaffNumberAudit,
    recordPhoneAudit,
  );
  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 수정 교직원',
      studentId: null,
      staffNumber: null,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
    },
  ]);
});
it('프로필 저장은 User 한 행에 canonical 사실을 남긴다', async () => {
  const expected = firstProfile;
  await expect(completeCurrentProfile(expected)).resolves.toBe('completed');
  await expect(readProfileRow()).resolves.toEqual([
    {
      ...expected,
      staffNumber: null,
      memberKind: MemberKind.STUDENT,
      departmentType: DepartmentType.DEPARTMENT,
    },
  ]);
});
it('완료 후 이름·학과 수정도 User만 갱신한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  const mutableFields = {
    name: '합성 수정 사용자',
    department: '컴퓨터공학과',
  };
  await repository.updateProfileFields(
    await currentStoredProfile(githubId),
    {
      ...mutableFields,
      departmentType: DepartmentType.DEPARTMENT,
    },
    recordStaffNumberAudit,
    recordPhoneAudit,
  );
  await expect(readProfileRow()).resolves.toEqual([
    {
      ...firstProfile,
      staffNumber: null,
      ...mutableFields,
      memberKind: MemberKind.STUDENT,
      departmentType: DepartmentType.DEPARTMENT,
    },
  ]);
});
it('교직원 번호를 설정해도 학번·회원 유형·권한과 완료 상태를 보존한다', async () => {
  const profile = {
    name: '번호 설정 학생',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(staffNumberSetUserId, staffNumberSetGithubId);
  await expect(
    completeProfileFor(
      staffNumberSetGithubId,
      profile,
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  await prisma.user.update({
    where: { id: staffNumberSetUserId },
    data: { admin: { create: { origin: 'BOOTSTRAP' } } },
  });
  const current = await repository.findByGithubId(staffNumberSetGithubId);
  if (!current || current.name === null || current.department === null) {
    throw new Error('번호 설정 합성 사용자가 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberSetGithubId, {
    name: current.name,
    department: current.department,
    staffNumber: '교직원-😀',
  });
  await expect(readProfileRow(staffNumberSetUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '교직원-😀',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
      department: profile.department,
    },
  ]);
  const after = await repository.findByGithubId(staffNumberSetGithubId);
  expect(after).toMatchObject({
    staffNumber: '교직원-😀',
    studentId: null,
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    approvalStatus: 'PENDING',
    hasAdminAccess: true,
    hasPendingStaffRequest: true,
  });
  if (!after) throw new TypeError('Expected saved profile fixture');
  expect(userProfileService.isCompleteUserProfile(after)).toBe(true);
  await expect(
    readStaffNumberAudits(staffNumberSetUserId),
  ).resolves.toMatchObject([
    {
      action: 'USER_PROFILE_UPDATED',
      targetId: staffNumberSetUserId,
      metadata: {
        changes: [{ field: 'staffNumber', before: null, after: '교직원-😀' }],
      },
    },
  ]);
});
it('교직원 번호 교체 감사는 잠긴 현재값을 before로 남긴다', async () => {
  const profile = {
    name: '번호 교체 교직원',
    studentId: null,
    department: '소프트웨어학부',
  };
  await createStaffNumberUser(
    staffNumberReplaceUserId,
    staffNumberReplaceGithubId,
  );
  await expect(
    completeProfileFor(
      staffNumberReplaceGithubId,
      profile,
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberReplaceGithubId);
  if (!initial || initial.name === null || initial.department === null) {
    throw new Error('번호 교체 합성 사용자가 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberReplaceGithubId, {
    name: initial.name,
    department: initial.department,
    staffNumber: '기존-번호',
  });
  const stale = await repository.findByGithubId(staffNumberReplaceGithubId);
  if (!stale || stale.name === null || stale.department === null) {
    throw new Error('번호 교체 합성 스냅샷이 존재해야 합니다.');
  }
  await prisma.user.update({
    where: { id: staffNumberReplaceUserId },
    data: { staffNumber: '잠금-직전-번호' },
  });
  const staleRead = jest
    .spyOn(repository, 'findByGithubId')
    .mockResolvedValueOnce(stale);
  try {
    await service.patchMyProfile(staffNumberReplaceGithubId, {
      name: stale.name,
      department: stale.department,
      staffNumber: '교체-번호',
    });
  } finally {
    staleRead.mockRestore();
  }
  await expect(readProfileRow(staffNumberReplaceUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '교체-번호',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
      department: profile.department,
    },
  ]);
  const audits = await readStaffNumberAudits(staffNumberReplaceUserId);
  const identity = {
    displayName: profile.name,
    githubLogin: staffNumberReplaceUserId,
  };
  expect(audits).toHaveLength(2);
  expect(audits).toEqual(
    expect.arrayContaining([
      {
        action: 'USER_PROFILE_UPDATED',
        targetId: staffNumberReplaceUserId,
        metadata: {
          schemaVersion: 1,
          actor: identity,
          target: identity,
          changes: [{ field: 'staffNumber', before: null, after: '기존-번호' }],
        },
      },
      {
        action: 'USER_PROFILE_UPDATED',
        targetId: staffNumberReplaceUserId,
        metadata: {
          schemaVersion: 1,
          actor: identity,
          target: identity,
          changes: [
            {
              field: 'staffNumber',
              before: '잠금-직전-번호',
              after: '교체-번호',
            },
          ],
        },
      },
    ]),
  );
});
it('교직원 번호를 null로 보내면 canonical 값을 지우고 감사한다', async () => {
  const profile = {
    name: '번호 삭제 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(staffNumberClearUserId, staffNumberClearGithubId);
  await expect(
    completeProfileFor(
      staffNumberClearGithubId,
      profile,
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberClearGithubId);
  if (!initial || initial.name === null || initial.department === null) {
    throw new Error('번호 삭제 합성 사용자가 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberClearGithubId, {
    name: initial.name,
    department: initial.department,
    staffNumber: '지울-번호',
  });
  const current = await repository.findByGithubId(staffNumberClearGithubId);
  if (!current || current.name === null || current.department === null) {
    throw new Error('번호 삭제 현재 프로필이 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberClearGithubId, {
    name: current.name,
    department: current.department,
    staffNumber: null,
  });
  await expect(readProfileRow(staffNumberClearUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: null,
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
      department: profile.department,
    },
  ]);
  const audits = await readStaffNumberAudits(staffNumberClearUserId);
  const identity = {
    displayName: profile.name,
    githubLogin: staffNumberClearUserId,
  };
  expect(audits).toHaveLength(2);
  expect(audits).toEqual(
    expect.arrayContaining([
      {
        action: 'USER_PROFILE_UPDATED',
        targetId: staffNumberClearUserId,
        metadata: {
          schemaVersion: 1,
          actor: identity,
          target: identity,
          changes: [{ field: 'staffNumber', before: null, after: '지울-번호' }],
        },
      },
      {
        action: 'USER_PROFILE_UPDATED',
        targetId: staffNumberClearUserId,
        metadata: {
          schemaVersion: 1,
          actor: identity,
          target: identity,
          changes: [{ field: 'staffNumber', before: '지울-번호', after: null }],
        },
      },
    ]),
  );
});
it('교직원 번호를 생략하면 기존 canonical 값과 감사 이력을 보존한다', async () => {
  const profile = {
    name: '번호 생략 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(
    staffNumberOmittedUserId,
    staffNumberOmittedGithubId,
  );
  await expect(
    completeProfileFor(
      staffNumberOmittedGithubId,
      profile,
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberOmittedGithubId);
  if (!initial || initial.name === null || initial.department === null) {
    throw new Error('번호 생략 합성 사용자가 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberOmittedGithubId, {
    name: initial.name,
    department: initial.department,
    staffNumber: '보존-번호',
  });
  const current = await repository.findByGithubId(staffNumberOmittedGithubId);
  if (!current || current.name === null || current.department === null) {
    throw new Error('번호 생략 현재 프로필이 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberOmittedGithubId, {
    name: current.name,
    department: current.department,
  });
  await expect(readProfileRow(staffNumberOmittedUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '보존-번호',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
    },
  ]);
  await expect(
    readStaffNumberAudits(staffNumberOmittedUserId),
  ).resolves.toHaveLength(1);
});
it('교직원 번호 no-op은 canonical 값을 유지하고 새 감사 없이 끝난다', async () => {
  const profile = {
    name: '번호 재전송 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(staffNumberNoopUserId, staffNumberNoopGithubId);
  await expect(
    completeProfileFor(
      staffNumberNoopGithubId,
      profile,
      MemberKind.STAFF,
      DepartmentType.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberNoopGithubId);
  if (!initial || initial.name === null || initial.department === null) {
    throw new Error('번호 no-op 합성 사용자가 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberNoopGithubId, {
    name: initial.name,
    department: initial.department,
    staffNumber: '같은-번호',
  });
  const current = await repository.findByGithubId(staffNumberNoopGithubId);
  if (!current || current.name === null || current.department === null) {
    throw new Error('번호 no-op 현재 프로필이 존재해야 합니다.');
  }
  await service.patchMyProfile(staffNumberNoopGithubId, {
    name: current.name,
    department: current.department,
    staffNumber: '같은-번호',
  });
  await expect(readProfileRow(staffNumberNoopUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '같은-번호',
      memberKind: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
      department: profile.department,
    },
  ]);
  await expect(
    readStaffNumberAudits(staffNumberNoopUserId),
  ).resolves.toHaveLength(1);
});
it('사번 감사 기록이 실패하면 프로필 변경도 롤백한다', async () => {
  const id = 'test:users:profile:staff-number:rollback';
  const rollbackGithubId = 9600000000153106n;
  const profile = {
    name: '합성 롤백 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(id, rollbackGithubId);
  await completeProfileFor(
    rollbackGithubId,
    profile,
    MemberKind.STAFF,
    DepartmentType.PROGRAM_OFFICE,
  );
  const before = await readProfileRow(id);
  const failure = new Error('Synthetic audit failure');
  const rejectingService = new UsersService(
    repository,
    { requireCurrent: () => Promise.resolve() },
    { record: jest.fn().mockRejectedValue(failure) },
    new HistoryMetadataService(),
    new UserProfileService(),
  );
  await expect(
    rejectingService.patchMyProfile(rollbackGithubId, {
      name: '저장되면 안 되는 이름',
      department: profile.department,
      staffNumber: 'ROLLBACK-42',
    }),
  ).rejects.toBe(failure);
  await expect(readProfileRow(id)).resolves.toEqual(before);
  await expect(readStaffNumberAudits(id)).resolves.toEqual([]);
});
it('읽은 뒤 학생으로 바뀐 계정은 잠긴 현재 회원 유형으로 사번 수정을 거부한다', async () => {
  const id = 'test:users:profile:staff-number:stale-kind';
  const staleGithubId = 9600000000153107n;
  const profile = {
    name: '합성 유형 변경 사용자',
    studentId: null,
    department: '인공지능학부',
  };
  await createStaffNumberUser(id, staleGithubId);
  await completeProfileFor(
    staleGithubId,
    profile,
    MemberKind.STAFF,
    DepartmentType.PROGRAM_OFFICE,
  );
  const stale = await repository.findByGithubId(staleGithubId);
  if (!stale) throw new Error('합성 유형 변경 프로필이 존재해야 합니다.');
  await prisma.user.update({
    where: { id: id },
    data: {
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      type: MemberKind.STUDENT,
      studentId: '953107',
      departmentType: DepartmentType.DEPARTMENT,
    },
  });
  const before = await readProfileRow(id);
  await expect(
    repository.updateProfileFields(
      stale,
      {
        name: profile.name,
        department: profile.department,
        staffNumber: 'DENIED-42',
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    ),
  ).rejects.toMatchObject({ errorCode: { code: 'SYS_003', status: 400 } });
  await expect(readProfileRow(id)).resolves.toEqual(before);
  await expect(readStaffNumberAudits(id)).resolves.toEqual([]);
  expect(recordStaffNumberAudit).not.toHaveBeenCalled();
  expect(recordPhoneAudit).not.toHaveBeenCalled();
});
