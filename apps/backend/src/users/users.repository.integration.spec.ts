import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuditLogRepository } from '../audit-log/repository/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { UsersRepository } from './users.repository';
import type { ProfileCompletionOutcome } from './users.repository';
import { isCompleteUserProfile } from './domain/user-profile-policy';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
const otherUserId = 'test:users:profile:other';
const staffNumberSetUserId = 'test:users:profile:staff-number:set';
const staffNumberSetGithubId = 9_600_000_000_153_201n;
const staffNumberReplaceUserId = 'test:users:profile:staff-number:replace';
const staffNumberReplaceGithubId = 9_600_000_000_153_102n;
const staffNumberClearUserId = 'test:users:profile:staff-number:clear';
const staffNumberClearGithubId = 9_600_000_000_153_103n;
const staffNumberOmittedUserId = 'test:users:profile:staff-number:omitted';
const staffNumberOmittedGithubId = 9_600_000_000_153_104n;
const staffNumberNoopUserId = 'test:users:profile:staff-number:noop';
const staffNumberNoopGithubId = 9_600_000_000_153_105n;
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
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

const prisma = new PrismaService();
const repository = new UsersRepository(
  prisma,
  new AuditLogService(new AuditLogRepository(prisma)),
);

const profileTarget = {
  id: userId,
  name: null,
  studentId: null,
  department: null,
};

async function completeProfileFor(
  profileGithubId: bigint,
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  },
  memberKind: MemberKind = MemberKind.STUDENT,
  affiliationKind: AffiliationKind = AffiliationKind.DEPARTMENT,
): Promise<ProfileCompletionOutcome> {
  const current = await repository.findByGithubId(profileGithubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  return repository.completeProfileIfUnchanged(
    current,
    canonicalCompletion(profile, memberKind, affiliationKind),
  );
}

async function completeCurrentProfile(
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  },
  memberKind: MemberKind = MemberKind.STUDENT,
  affiliationKind: AffiliationKind = AffiliationKind.DEPARTMENT,
): Promise<ProfileCompletionOutcome> {
  return completeProfileFor(githubId, profile, memberKind, affiliationKind);
}

function readProfileRow(
  profileUserId = userId,
): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "staffNumber", "department",
           "memberKind", "affiliationKind", "affiliationName"
    FROM "UserProfile"
    WHERE "userId" = ${profileUserId}
  `;
}

function readStaffNumberAudits(profileUserId: string) {
  return prisma.auditLog.findMany({
    where: {
      actorId: profileUserId,
      targetType: 'USER',
      targetId: profileUserId,
      action: 'USER_PROFILE_UPDATED',
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { action: true, targetId: true, metadata: true },
  });
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
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.staffAccessRequest.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      selectedMemberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
});

afterAll(async () => {
  await prisma.staffAccessRequest.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.$disconnect();
});

it('학번·학과를 UserProfile에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    githubId,
    githubLogin: 'synthetic-profile-user',
    phone: null,
    staffNumber: null,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: firstProfile.department,
    hasStaffAccess: false,
    hasAdminAccess: false,
    hasPendingStaffRequest: false,
    ...firstProfile,
  });
});

it('학번 없는 교직원 프로필은 UserProfile 행으로 저장된다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });

  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');

  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 교직원',
      studentId: null,
      staffNumber: null,
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
    },
  ]);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '인공지능학부',
    studentId: null,
    department: '인공지능학부',
    hasStaffAccess: false,
    hasAdminAccess: false,
    hasPendingStaffRequest: true,
  });
});

it('완료된 프로필의 이름·소속을 갱신할 수 있다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');

  await repository.updateProfileFields(profileTarget, {
    name: '합성 수정 교직원',
    department: '소프트웨어공학과',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '소프트웨어공학과',
  });

  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 수정 교직원',
      studentId: null,
      staffNumber: null,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '소프트웨어공학과',
    },
  ]);
});

it('프로필 저장은 UserProfile 한 행에 canonical 사실을 남긴다', async () => {
  const expected = firstProfile;

  await expect(completeCurrentProfile(expected)).resolves.toBe('completed');

  await expect(readProfileRow()).resolves.toEqual([
    {
      ...expected,
      staffNumber: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: expected.department,
    },
  ]);
});

it('완료 후 이름·학과 수정도 UserProfile만 갱신한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  const mutableFields = {
    name: '합성 수정 사용자',
    department: '컴퓨터공학과',
  };

  await repository.updateProfileFields(profileTarget, {
    ...mutableFields,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: mutableFields.department,
  });

  await expect(readProfileRow()).resolves.toEqual([
    {
      ...firstProfile,
      staffNumber: null,
      ...mutableFields,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: mutableFields.department,
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
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  await prisma.user.update({
    where: { id: staffNumberSetUserId },
    data: { hasAdminAccess: true },
  });

  const current = await repository.findByGithubId(staffNumberSetGithubId);
  if (!current) {
    throw new Error('번호 설정 합성 사용자가 존재해야 합니다.');
  }
  await repository.updateProfileFields(current, {
    name: current.name!,
    department: current.department!,
    staffNumber: '교직원-😀',
  });

  await expect(readProfileRow(staffNumberSetUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '교직원-😀',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: profile.department,
    },
  ]);
  const after = await repository.findByGithubId(staffNumberSetGithubId);
  expect(after).toMatchObject({
    staffNumber: '교직원-😀',
    studentId: null,
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    hasStaffAccess: false,
    hasAdminAccess: true,
    hasPendingStaffRequest: true,
  });
  expect(after).not.toBeNull();
  expect(isCompleteUserProfile(after!)).toBe(true);
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
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberReplaceGithubId);
  if (!initial) {
    throw new Error('번호 교체 합성 사용자가 존재해야 합니다.');
  }
  await repository.updateProfileFields(initial, {
    name: initial.name!,
    department: initial.department!,
    staffNumber: '기존-번호',
  });
  const stale = await repository.findByGithubId(staffNumberReplaceGithubId);
  if (!stale) {
    throw new Error('번호 교체 합성 스냅샷이 존재해야 합니다.');
  }
  await prisma.userProfile.update({
    where: { userId: staffNumberReplaceUserId },
    data: { staffNumber: '잠금-직전-번호' },
  });

  await repository.updateProfileFields(stale, {
    name: stale.name!,
    department: stale.department!,
    staffNumber: '교체-번호',
  });

  await expect(readProfileRow(staffNumberReplaceUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '교체-번호',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: profile.department,
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
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberClearGithubId);
  if (!initial) {
    throw new Error('번호 삭제 합성 사용자가 존재해야 합니다.');
  }
  await repository.updateProfileFields(initial, {
    name: initial.name!,
    department: initial.department!,
    staffNumber: '지울-번호',
  });
  const current = await repository.findByGithubId(staffNumberClearGithubId);
  if (!current) {
    throw new Error('번호 삭제 현재 프로필이 존재해야 합니다.');
  }

  await repository.updateProfileFields(current, {
    name: current.name!,
    department: current.department!,
    staffNumber: null,
  });

  await expect(readProfileRow(staffNumberClearUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: null,
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: profile.department,
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
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberOmittedGithubId);
  if (!initial) {
    throw new Error('번호 생략 합성 사용자가 존재해야 합니다.');
  }
  await repository.updateProfileFields(initial, {
    name: initial.name!,
    department: initial.department!,
    staffNumber: '보존-번호',
  });
  const current = await repository.findByGithubId(staffNumberOmittedGithubId);
  if (!current) {
    throw new Error('번호 생략 현재 프로필이 존재해야 합니다.');
  }

  await repository.updateProfileFields(current, {
    name: current.name!,
    department: current.department!,
  });

  await expect(readProfileRow(staffNumberOmittedUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '보존-번호',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: profile.department,
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
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');
  const initial = await repository.findByGithubId(staffNumberNoopGithubId);
  if (!initial) {
    throw new Error('번호 no-op 합성 사용자가 존재해야 합니다.');
  }
  await repository.updateProfileFields(initial, {
    name: initial.name!,
    department: initial.department!,
    staffNumber: '같은-번호',
  });
  const current = await repository.findByGithubId(staffNumberNoopGithubId);
  if (!current) {
    throw new Error('번호 no-op 현재 프로필이 존재해야 합니다.');
  }

  await repository.updateProfileFields(current, {
    name: current.name!,
    department: current.department!,
    staffNumber: '같은-번호',
  });

  await expect(readProfileRow(staffNumberNoopUserId)).resolves.toEqual([
    {
      ...profile,
      staffNumber: '같은-번호',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: profile.department,
    },
  ]);
  await expect(
    readStaffNumberAudits(staffNumberNoopUserId),
  ).resolves.toHaveLength(1);
});

it('사번 감사 기록이 실패하면 프로필 변경도 롤백한다', async () => {
  const id = 'test:users:profile:staff-number:rollback';
  const rollbackGithubId = 9_600_000_000_153_106n;
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
    AffiliationKind.PROGRAM_OFFICE,
  );
  const current = await repository.findByGithubId(rollbackGithubId);
  if (!current) throw new Error('합성 롤백 프로필이 존재해야 합니다.');
  const before = await readProfileRow(id);
  const failure = new Error('Synthetic audit failure');
  const rejectingRepository = new UsersRepository(prisma, {
    record: jest.fn().mockRejectedValue(failure),
  });
  await expect(
    rejectingRepository.updateProfileFields(current, {
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
  const staleGithubId = 9_600_000_000_153_107n;
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
    AffiliationKind.PROGRAM_OFFICE,
  );
  const stale = await repository.findByGithubId(staleGithubId);
  if (!stale) throw new Error('합성 유형 변경 프로필이 존재해야 합니다.');
  await prisma.userProfile.update({
    where: { userId: id },
    data: {
      memberKind: MemberKind.STUDENT,
      studentId: '953107',
      affiliationKind: AffiliationKind.DEPARTMENT,
    },
  });
  const before = await readProfileRow(id);
  await expect(
    repository.updateProfileFields(stale, {
      name: profile.name,
      department: profile.department,
      staffNumber: 'DENIED-42',
    }),
  ).rejects.toMatchObject({ errorCode: { code: 'SYS_003', status: 400 } });
  await expect(readProfileRow(id)).resolves.toEqual(before);
  await expect(readStaffNumberAudits(id)).resolves.toEqual([]);
});
