import { AffiliationKind, MemberKind, ProgramCategory } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationsErrorCode } from '../domain/applications-error-code.enum';
import { ApplicationsRepository } from '../repository/applications.repository';
import { StudentApplicationManagementRepository } from '../repository/student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const applicationsRepository = new ApplicationsRepository(prisma);
const now = () => NOW;
const repository = new StudentApplicationManagementRepository(prisma, now);
const service = new StudentApplicationManagementService(
  repository,
  applicationsRepository,
);
const STUDENT_ID = 'student-application-race-student';
const GITHUB_ID = 8_000_000_000_101n;

const MEMBER_ID = 'student-application-race-member';
const MEMBER_GITHUB_ID = 8_000_000_000_102n;
const PROGRAM_ID = 'student-application-race-program';
const APPLICATION_ID = 'student-application-race-application';
const NOW = new Date('2026-07-15T00:00:00.000Z');

async function seedApplication(): Promise<void> {
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Student application race program',
      organizer: 'Synthetic organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
      description: 'Synthetic description',
    },
  });
  await prisma.team.create({
    data: {
      id: `${APPLICATION_ID}-team`,
      programId: PROGRAM_ID,
      name: 'student-application-race-team',
      joinCodeDigest: 'student-application-race-team-digest',
      leaderId: STUDENT_ID,
    },
  });
  await prisma.teamMember.createMany({
    data: [STUDENT_ID, MEMBER_ID].map((userId) => ({
      teamId: `${APPLICATION_ID}-team`,
      programId: PROGRAM_ID,
      userId,
    })),
  });
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      applicantId: STUDENT_ID,
      teamId: `${APPLICATION_ID}-team`,
      answers: {
        applicantName: 'Synthetic Student',
        title: 'Original title',
        summary: 'Original summary',
      },
      applicationTemplateVersion: 1,
    },
  });
}

async function expectDomainCode(
  operation: Promise<unknown>,
  code: ApplicationsErrorCode,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected DomainException ${code}`);
  } catch (error: unknown) {
    if (!(error instanceof DomainException)) throw error;
    expect(error.errorCode.code).toBe(code);
  }
}

function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what}이(가) 있어야 하는 시나리오다`);
  return value;
}

describe('StudentApplicationManagementService integration races', () => {
  beforeAll(async () => {
    await prisma.$connect();
    for (const student of [
      {
        id: STUDENT_ID,
        githubId: GITHUB_ID,
        nickname: 'synthetic-student',
        studentId: '304001',
      },
      {
        id: MEMBER_ID,
        githubId: MEMBER_GITHUB_ID,
        nickname: 'synthetic-member',
        studentId: '304002',
      },
    ]) {
      await prisma.user.create({
        data: {
          id: student.id,
          githubId: student.githubId,
          nickname: student.nickname,
          selectedMemberKind: MemberKind.STUDENT,
          profile: {
            create: {
              name: 'Synthetic user',
              studentId: student.studentId,
              department: 'Synthetic department',
              memberKind: MemberKind.STUDENT,
              affiliationKind: AffiliationKind.DEPARTMENT,
              affiliationName: 'Synthetic department',
            },
          },
        },
      });
    }
  });

  beforeEach(seedApplication);

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [STUDENT_ID, MEMBER_ID] } },
    });
    await prisma.$disconnect();
  });

  it('일반 팀원의 취소를 거절하고 신청서 행을 남긴다', async () => {
    await expectDomainCode(
      service.cancelMine(MEMBER_GITHUB_ID, PROGRAM_ID, NOW),
      ApplicationsErrorCode.APPLICATION_NOT_FOUND,
    );

    await expect(
      prisma.application.count({ where: { id: APPLICATION_ID } }),
    ).resolves.toBe(1);
  });

  it('일반 팀원의 수정을 거절하고 답변을 그대로 둔다', async () => {
    await expectDomainCode(
      service.updateMine(
        MEMBER_GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: 'Hijacked title' },
          applicationTemplateVersion: 1,
        },
        NOW,
      ),
      ApplicationsErrorCode.APPLICATION_NOT_FOUND,
    );

    const stored = await prisma.application.findUnique({
      where: { id: APPLICATION_ID },
      select: { answers: true },
    });
    expect(stored?.answers).toMatchObject({ title: 'Original title' });
  });

  it('일반 팀원의 조회는 그대로 열어 두되 관리 권한은 내린다', async () => {
    const view = present(
      await service.getMine(MEMBER_GITHUB_ID, PROGRAM_ID, NOW),
      '신청',
    );

    expect(view.id).toBe(APPLICATION_ID);
    expect(view.answers.title).toBe('Original title');
    expect(view.canManage).toBe(false);
  });

  it('신청자 겸 팀장의 취소는 그대로 성공한다', async () => {
    await expect(
      service.cancelMine(GITHUB_ID, PROGRAM_ID, NOW),
    ).resolves.toEqual({ cancelled: true });

    await expect(
      prisma.application.count({ where: { id: APPLICATION_ID } }),
    ).resolves.toBe(0);
  });

  it.each(['update', 'cancel'] as const)(
    'revalidates the application period inside the %s mutation transaction',
    async (operation) => {
      const closeProgram = async () => {
        await prisma.program.update({
          where: { id: PROGRAM_ID },
          data: { applicationEndAt: new Date('2026-07-14T23:59:59.000Z') },
        });
      };

      if (operation === 'update') {
        const original = repository.updatePendingApplication.bind(repository);
        jest
          .spyOn(repository, 'updatePendingApplication')
          .mockImplementationOnce(async (input) => {
            await closeProgram();
            return original(input);
          });
        await expectDomainCode(
          service.updateMine(
            GITHUB_ID,
            PROGRAM_ID,
            {
              answers: { title: 'Updated title' },
              applicationTemplateVersion: 1,
            },
            NOW,
          ),
          ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
        );
      } else {
        const original = repository.deletePendingApplication.bind(repository);
        jest
          .spyOn(repository, 'deletePendingApplication')
          .mockImplementationOnce(async (input) => {
            await closeProgram();
            return original(input);
          });
        await expectDomainCode(
          service.cancelMine(GITHUB_ID, PROGRAM_ID, NOW),
          ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
        );
      }
    },
  );

  it('classifies the PATCH loser as APP_001 when DELETE wins', async () => {
    const originalUpdate = repository.updatePendingApplication.bind(repository);
    let releaseUpdate: (() => void) | undefined;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let updateReached: (() => void) | undefined;
    const updateReady = new Promise<void>((resolve) => {
      updateReached = resolve;
    });
    jest
      .spyOn(repository, 'updatePendingApplication')
      .mockImplementationOnce(async (input) => {
        updateReached?.();
        await updateGate;
        return originalUpdate(input);
      });

    const update = service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: 'Updated title' },
        applicationTemplateVersion: 1,
      },
      NOW,
    );
    await updateReady;
    await service.cancelMine(GITHUB_ID, PROGRAM_ID, NOW);
    releaseUpdate?.();

    await expectDomainCode(update, ApplicationsErrorCode.APPLICATION_NOT_FOUND);
  });

  it('classifies exactly one DELETE loser as APP_001', async () => {
    const originalDelete = repository.deletePendingApplication.bind(repository);
    let callCount = 0;
    let releaseBoth: (() => void) | undefined;
    const bothReady = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    jest
      .spyOn(repository, 'deletePendingApplication')
      .mockImplementation(async (input) => {
        callCount += 1;
        if (callCount === 2) releaseBoth?.();
        await bothReady;
        return originalDelete(input);
      });

    const results = await Promise.allSettled([
      service.cancelMine(GITHUB_ID, PROGRAM_ID, NOW),
      service.cancelMine(GITHUB_ID, PROGRAM_ID, NOW),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejection?.reason).toBeInstanceOf(DomainException);
    expect((rejection?.reason as DomainException).errorCode.code).toBe(
      ApplicationsErrorCode.APPLICATION_NOT_FOUND,
    );
  });
});

describe('StudentApplicationManagementService — 반려 재제출(R-1)', () => {
  beforeAll(async () => {
    await prisma.$connect();

    for (const student of [
      {
        id: STUDENT_ID,
        githubId: GITHUB_ID,
        nickname: 'synthetic-student',
        studentId: '304001',
      },
      {
        id: MEMBER_ID,
        githubId: MEMBER_GITHUB_ID,
        nickname: 'synthetic-member',
        studentId: '304002',
      },
    ]) {
      await prisma.user.create({
        data: {
          id: student.id,
          githubId: student.githubId,
          nickname: student.nickname,
          selectedMemberKind: MemberKind.STUDENT,
          profile: {
            create: {
              name: 'Synthetic user',
              studentId: student.studentId,
              department: 'Synthetic department',
              memberKind: MemberKind.STUDENT,
              affiliationKind: AffiliationKind.DEPARTMENT,
              affiliationName: 'Synthetic department',
            },
          },
        },
      });
    }
  });

  beforeEach(async () => {
    await seedApplication();
    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { status: 'REJECTED', rejectionReason: '서류가 비었습니다' },
    });
  });

  afterEach(async () => {
    await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [STUDENT_ID, MEMBER_ID] } },
    });
    await prisma.$disconnect();
  });

  it('반려 신청을 고쳐 내면 검토대기로 돌아가고 재제출 이력이 정확히 1행 는다', async () => {
    const updated = await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
      NOW,
    );

    expect(updated.status).toBe('SUBMITTED');
    expect(updated.rejectionReason).toBeNull();
    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_ID },
      select: { status: true, rejectionReason: true, revision: true },
    });
    expect(stored).toEqual({
      status: 'SUBMITTED',
      rejectionReason: null,
      revision: 2,
    });

    const history = await prisma.applicationReviewHistory.findMany({
      where: { applicationId: APPLICATION_ID },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      eventKind: 'RESUBMITTED',
      revision: 2,
      actorId: STUDENT_ID,
      rejectionReason: null,
    });
  });

  it('검토대기 신청의 수정은 이력도 회차도 건드리지 않는다', async () => {
    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { status: 'SUBMITTED', rejectionReason: null },
    });

    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
      NOW,
    );

    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_ID },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: { revision: true },
      }),
    ).resolves.toEqual({ revision: 1 });
  });

  it('신청 기간이 닫힌 뒤의 반려 재제출은 기간 오류로 막히고 아무것도 바뀌지 않는다', async () => {
    await expectDomainCode(
      service.updateMine(
        GITHUB_ID,
        PROGRAM_ID,
        { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
        new Date('2027-01-01T00:00:00.000Z'),
      ),
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    );

    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: { status: true, revision: true },
      }),
    ).resolves.toEqual({ status: 'REJECTED', revision: 1 });
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_ID },
      }),
    ).resolves.toBe(0);
  });

  it('연속 재제출은 회차가 1씩 전진하고 이력이 쌓인다', async () => {
    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '첫 수정' }, applicationTemplateVersion: 1 },
      NOW,
    );

    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { status: 'REJECTED', rejectionReason: '아직 부족합니다' },
    });

    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '둘째 수정' }, applicationTemplateVersion: 1 },
      NOW,
    );

    const history = await prisma.applicationReviewHistory.findMany({
      where: { applicationId: APPLICATION_ID },
      orderBy: { revision: 'asc' },
      select: { eventKind: true, revision: true },
    });
    expect(history).toEqual([
      { eventKind: 'RESUBMITTED', revision: 2 },
      { eventKind: 'RESUBMITTED', revision: 3 },
    ]);
  });
});
