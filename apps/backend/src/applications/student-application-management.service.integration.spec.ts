import { MemberKind, ProgramCategory } from '@prisma/client';
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
  await prisma.teamMember.create({
    data: {
      teamId: `${APPLICATION_ID}-team`,
      programId: PROGRAM_ID,
      userId: STUDENT_ID,
    },
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
    await prisma.user.create({
      data: {
        id: STUDENT_ID,
        githubId: GITHUB_ID,
        nickname: 'synthetic-student',
        selectedMemberKind: MemberKind.STUDENT,
      },
    });
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
    await prisma.user.deleteMany({ where: { id: STUDENT_ID } });
    await prisma.$disconnect();
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
              answers: { title: 'Updated title', summary: 'Updated summary' },
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
        answers: { title: 'Updated title', summary: 'Updated summary' },
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
