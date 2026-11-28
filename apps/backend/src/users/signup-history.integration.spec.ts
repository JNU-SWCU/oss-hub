import { AuthRepository } from '../auth/auth.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import type { ConsentsService } from './consents.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { MemberOnboardingRepository } from './member-onboarding.repository';
import { MemberOnboardingService } from './member-onboarding.service';
import { MemberKind } from './user-contract.config';
import { UserProfileService } from './user-profile.service';
import { UserTransitionRepository } from './user-transition.repository';
import { UsersRepository, type UsersRepositoryPort } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60000;
const STUDENT_GITHUB_ID = 9_000_000_202_801n;
const STAFF_GITHUB_ID = 9_000_000_202_802n;
const RETURNING_GITHUB_ID = 9_000_000_202_803n;

type PhoneAuditCallback = Parameters<
  UsersRepositoryPort['completeProfileIfUnchanged']
>[2];

const prisma = new PrismaService();
const transitions = new UserTransitionRepository();
const auth = new AuthRepository(prisma);
const users = new UsersRepository(prisma, transitions);
const consents: Pick<ConsentsService, 'requireCurrent'> = {
  requireCurrent: jest.fn().mockResolvedValue(undefined),
};
const onboarding = new MemberOnboardingService(
  new MemberOnboardingRepository(prisma, transitions),
  consents,
  new UserProfileService(),
);
const recordPhoneAudit = jest
  .fn<Promise<void>, Parameters<PhoneAuditCallback>>()
  .mockResolvedValue(undefined);

async function signIn(githubId: bigint, login: string): Promise<string> {
  const { user } = await auth.withTransaction((store) =>
    store.upsertUser({
      githubId,
      login,
      name: null,
      avatarUrl: null,
      email: null,
    }),
  );
  return user.id;
}

async function completeProfile(
  githubId: bigint,
  memberKind: MemberKind,
  entry: { readonly name: string; readonly phone: string } = {
    name: '합성 가입자',
    phone: '00000202801',
  },
): Promise<void> {
  const current = await users.findByGithubId(githubId);
  if (!current) throw new Error('합성 가입자가 있어야 합니다.');
  const outcome = await users.completeProfileIfUnchanged(
    current,
    {
      ...canonicalCompletion(
        {
          name: entry.name,
          studentId:
            memberKind === MemberKind.STUDENT
              ? String(githubId).slice(-6)
              : null,
          department: '인공지능학부',
        },
        memberKind,
      ),
      phone: entry.phone,
    },
    recordPhoneAudit,
  );
  expect(outcome).toBe('completed');
}

async function historyEvents(userId: string): Promise<readonly string[]> {
  const rows = await prisma.userHistory.findMany({
    where: { userId },
    orderBy: { occurredAt: 'asc' },
    select: { event: true },
    take: 10,
  });
  return rows.map((row) => row.event);
}

beforeAll(async () => {
  await prisma.$connect();
}, DATABASE_CONNECTION_TIMEOUT_MS);

beforeEach(() => {
  recordPhoneAudit.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('가입 이력', () => {
  it('학생 가입은 역할을 바꿔 고르고 프로필을 입력해도 회원 가입 한 건만 남긴다', async () => {
    const userId = await signIn(STUDENT_GITHUB_ID, 'synthetic-signup-student');

    await onboarding.selectMemberKind(STUDENT_GITHUB_ID, MemberKind.STAFF);
    await onboarding.selectMemberKind(STUDENT_GITHUB_ID, MemberKind.STUDENT);
    await completeProfile(STUDENT_GITHUB_ID, MemberKind.STUDENT);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { type: true, name: true, phone: true, profileCreatedAt: true },
    });
    expect(stored).toMatchObject({
      type: MemberKind.STUDENT,
      name: '합성 가입자',
      phone: '00000202801',
    });
    expect(stored.profileCreatedAt).not.toBeNull();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
    await expect(historyEvents(userId)).resolves.toEqual(['SIGNED_UP']);
  });

  it('교직원 가입은 회원 가입과 승인 신청만 남긴다', async () => {
    const userId = await signIn(STAFF_GITHUB_ID, 'synthetic-signup-staff');

    await onboarding.selectMemberKind(STAFF_GITHUB_ID, MemberKind.STAFF);
    await completeProfile(STAFF_GITHUB_ID, MemberKind.STAFF);

    await expect(historyEvents(userId)).resolves.toEqual([
      'SIGNED_UP',
      'APPROVAL_REQUESTED',
    ]);
  });

  it('가입을 마친 뒤 다시 입력하는 프로필은 변경으로 남긴다', async () => {
    const userId = await signIn(
      RETURNING_GITHUB_ID,
      'synthetic-signup-returning',
    );
    await onboarding.selectMemberKind(RETURNING_GITHUB_ID, MemberKind.STUDENT);
    await completeProfile(RETURNING_GITHUB_ID, MemberKind.STUDENT);
    expect(recordPhoneAudit).not.toHaveBeenCalled();

    await completeProfile(RETURNING_GITHUB_ID, MemberKind.STUDENT, {
      name: '합성 재입력자',
      phone: '00000202802',
    });

    expect(recordPhoneAudit).toHaveBeenCalledTimes(1);
    await expect(historyEvents(userId)).resolves.toEqual([
      'SIGNED_UP',
      'PROFILE_UPDATED',
    ]);
  });
});
