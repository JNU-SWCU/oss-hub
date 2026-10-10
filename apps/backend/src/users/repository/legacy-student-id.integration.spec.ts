import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { DomainException } from '../../common/error-code';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuditLogRepository } from '../../audit-log/repository/audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersErrorCode } from '../domain/users-error-code.enum';
import { UsersRepository } from './users.repository';
import { UsersService } from '../service/users.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const LEGACY_STUDENT_ID = '9'.repeat(9);
const NEW_ONBOARDING_PHONE = '80000999999';
const NEW_STUDENT_ID = '1'.repeat(6);
const userId = 'test:users:legacy-student-id';
const githubId = 9_600_000_000_153_101n;
const name = '합성 재학생';
const department = '인공지능학부';

type StoredProfileFields = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

const prisma = new PrismaService();

const service = new UsersService(
  new UsersRepository(prisma),
  {
    requireCurrent: () => Promise.resolve(),
  },
  new AuditLogService(new AuditLogRepository(prisma)),
);

function readProfileRow(): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department",
           "memberKind", "affiliationKind", "affiliationName"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('DomainException이 발생해야 합니다.');
}

beforeAll(async () => {
  await prisma.$connect();
});

async function resetLegacyStudent(): Promise<void> {
  await prisma.userProfile.deleteMany({ where: { userId } });

  const identity = {
    selectedMemberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    phone: null,
    profile: {
      create: {
        name,
        studentId: LEGACY_STUDENT_ID,
        department,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: department,
      },
    },
  };
  await prisma.user.upsert({
    where: { id: userId },
    update: identity,
    create: {
      id: userId,
      githubId,
      nickname: 'synthetic-legacy-student',
      ...identity,
    },
  });
}

beforeEach(resetLegacyStudent);

afterAll(async () => {
  await prisma.userProfile.deleteMany({ where: { userId } });
  await prisma.$disconnect();
});

it('예전 형식 학번으로 가입을 마친 학생은 완료된 프로필로 읽힌다', async () => {
  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name,
    studentId: LEGACY_STUDENT_ID,
    staffNumber: null,
    department,
    phone: null,
    isComplete: true,
  });
});

it('학번을 싣지 않은 저장은 예전 형식 학번을 건드리지 않고 통과한다', async () => {
  await expect(
    service.patchMyProfile(githubId, {
      name: '합성 재학생2',
      department: '소프트웨어공학과',
    }),
  ).resolves.toMatchObject({
    studentId: LEGACY_STUDENT_ID,
    isComplete: true,
  });

  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 재학생2',
      studentId: LEGACY_STUDENT_ID,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '소프트웨어공학과',
    },
  ]);
});

it('학번을 6자리로 바꾸려는 저장은 거절하고 데이터를 그대로 둔다', async () => {
  const exception = await captureDomainException(() =>
    service.patchMyProfile(githubId, {
      name,
      studentId: NEW_STUDENT_ID,
      department,
    }),
  );

  expect(exception.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);

  await expect(readProfileRow()).resolves.toEqual([
    {
      name,
      studentId: LEGACY_STUDENT_ID,
      department,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: department,
    },
  ]);
});

describe('학번이 없는 학생', () => {
  const NEW_ONBOARDING_STUDENT_ID = '2'.repeat(6);

  beforeEach(async () => {
    await prisma.userProfile.deleteMany({ where: { userId } });
  });

  it('미완료로 읽히고 새 6자리 학번으로 가입을 마친다', async () => {
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      studentId: null,
      isComplete: false,
    });

    await expect(
      service.completeMyProfile(githubId, {
        name,
        studentId: NEW_ONBOARDING_STUDENT_ID,
        phone: NEW_ONBOARDING_PHONE,
        department,
      }),
    ).resolves.toMatchObject({
      studentId: NEW_ONBOARDING_STUDENT_ID,
      isComplete: true,
    });

    await expect(readProfileRow()).resolves.toEqual([
      {
        name,
        studentId: NEW_ONBOARDING_STUDENT_ID,
        department,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: department,
      },
    ]);
  });

  it('형식이 틀린 새 학번은 400으로 거부한다', async () => {
    const exception = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name,
        studentId: LEGACY_STUDENT_ID,
        department,
      }),
    );

    expect(exception.errorCode.status).toBe(400);
    await expect(readProfileRow()).resolves.toEqual([]);
  });
});
