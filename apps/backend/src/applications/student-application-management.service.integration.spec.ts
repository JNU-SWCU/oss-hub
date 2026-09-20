import { AffiliationKind, MemberKind, ProgramCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsRepository } from './applications.repository';
import { StudentApplicationManagementRepository } from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const applicationsRepository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-student-application-race-secret',
});
const now = () => NOW;
const repository = new StudentApplicationManagementRepository(prisma, now);
const service = new StudentApplicationManagementService(
  repository,
  applicationsRepository,
);
const STUDENT_ID = 'student-application-race-student';
const GITHUB_ID = 8_000_000_000_101n;
/** 신청자도 팀장도 아닌 일반 팀원 — #1083 재현의 행위자. */
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

  /**
   * #1083 재현 — 팀장이 낸 신청서를 일반 팀원이 취소하면 팀 전체의 신청서가
   * **하드 삭제**됐다. 쓰기가 읽기와 같은 참가자 범위를 재사용한 탓이다.
   * 행이 남아 있는지까지 본다 — 거절 코드만 보면 지운 뒤 던지는 회귀를 놓친다.
   */
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

  /**
   * 읽기는 좁히지 않는다 — 판정 사유·답변을 팀원 전원이 읽는 것은 의도된
   * 범위이고 판정 알림 수신자와 같은 집합이다(#570). 쓰기만 좁힌 것을 고정한다.
   */
  it('일반 팀원의 조회는 그대로 열어 두되 관리 권한은 내린다', async () => {
    const view = await service.getMine(MEMBER_GITHUB_ID, PROGRAM_ID, NOW);

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

/**
 * R-1 — 반려된 신청서를 학생이 고쳐 다시 내면 검토대기로 돌아간다.
 * 상태 복귀·이력 append·회차 증가가 **한 커밋**에 함께 들어가는지가 요점이다.
 */
describe('StudentApplicationManagementService — 반려 재제출(R-1)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    // `seedApplication`이 팀원 두 명을 넣으므로 둘 다 있어야 한다.
    for (const student of [
      { id: STUDENT_ID, githubId: GITHUB_ID, nickname: 'synthetic-student', studentId: '304001' },
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
    // When
    const updated = await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
      NOW,
    );

    // Then: 상태가 돌아가고 지난 반려 사유는 헤더에서 지워진다.
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

    // 이력은 학생 행위자로 정확히 한 행이다.
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
    // Given: 아직 판정 전이다.
    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { status: 'SUBMITTED', rejectionReason: null },
    });

    // When
    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
      NOW,
    );

    // Then: 재제출이 아니라 단순 수정이다.
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
    // When
    await expectDomainCode(
      service.updateMine(
        GITHUB_ID,
        PROGRAM_ID,
        { answers: { title: '고친 제목' }, applicationTemplateVersion: 1 },
        new Date('2027-01-01T00:00:00.000Z'),
      ),
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    );

    // Then
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
    // Given: 한 번 재제출한다.
    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '첫 수정' }, applicationTemplateVersion: 1 },
      NOW,
    );
    // 교직원이 다시 반려한 상태를 만든다.
    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { status: 'REJECTED', rejectionReason: '아직 부족합니다' },
    });

    // When
    await service.updateMine(
      GITHUB_ID,
      PROGRAM_ID,
      { answers: { title: '둘째 수정' }, applicationTemplateVersion: 1 },
      NOW,
    );

    // Then
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
