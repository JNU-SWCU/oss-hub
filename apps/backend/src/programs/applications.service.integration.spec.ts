import { TeamHistoryRepository } from './team-history.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import {
  ApplicationStatus,
  ProgramCategory,
  ProgramLifecycle,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { ApplicationsErrorCode } from './applications-error-code.error';
import { ApplicationsRepository } from './team.repository';
import { APPLICATION_DECISION_ACTIONS } from './applications.config';
import { TeamApplicationService } from './team-application.service';
import { StudentApplicationManagementRepository } from './team.repository';
import { StudentApplicationManagementService } from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamRepository } from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  new PlatformRepository(),
);
const service = new TeamApplicationService(
  repository,
  new RepositoryUrlService(),
  new ApplicationAnswersService(),
  new RepositoryProvisionEventService(),
);
const studentService = new StudentApplicationManagementService(
  new StudentApplicationManagementRepository(
    prisma,
    new TeamHistoryRepository(),
    new PlatformRepository(),
  ),
  repository,
  new ApplicationAnswersService(),
);
const ACTOR_ID = 'synthetic-decision-actor';
const ACTOR_GITHUB_ID = 8_000_000_000_001n;
const APPLICANT_ID = 'synthetic-decision-applicant';
const APPLICANT_GITHUB_ID = 8_000_000_000_002n;
const TEAM_ID = 'synthetic-decision-team';
const CREATE_PROGRAM_ID = 'synthetic-create-program';
const CREATE_TEAM_ID = 'synthetic-create-team';
const APPLICATION_IDS = [
  'synthetic-enabled-application',
  'synthetic-disabled-application',
  'synthetic-rejected-application',
  'synthetic-parallel-application',
  'synthetic-conflict-application',
  'synthetic-decided-application',
  'synthetic-cancelled-application',
  'synthetic-transaction-failure-application',
  'synthetic-switch-reject-application',
  'synthetic-switch-approve-application',
  'synthetic-provisioned-application',
] as const;

async function createApplication(
  teamId: (typeof APPLICATION_IDS)[number],
  repositoryProvisioningEnabled: boolean,
): Promise<void> {
  const programId = `${teamId}-program`;
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date(
        new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
      ),
      id: programId,
      name: `program-${teamId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled,
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `team-${teamId}`,
      leaderId: APPLICANT_ID,
      applicantId: APPLICANT_ID,
      answers: { title: `team-${teamId}` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId,
      userId: APPLICANT_ID,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId: APPLICANT_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
}

describe('TeamApplicationService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: ACTOR_ID,
          githubId: 8000000000001n,
          nickname: 'Synthetic-Staff',
          type: MemberKind.STAFF,
          approvalStatus: 'APPROVED',
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: 'DEPARTMENT',
        },
        {
          id: 'synthetic-decision-member',
          githubId: 8000000000003n,
          nickname: 'Synthetic-Member',
          type: MemberKind.STUDENT,
        },
        {
          id: APPLICANT_ID,
          githubId: APPLICANT_GITHUB_ID,
          nickname: 'Synthetic-Applicant',
          type: MemberKind.STUDENT,
          approvalStatus: 'NOT_REQUIRED',
        },
      ],
    });
    await Promise.all(
      [
        {
          userId: ACTOR_ID,
          name: 'Synthetic user',
          studentId: null,
          department: 'Synthetic program office',
          type: MemberKind.STAFF,
          departmentType: DepartmentType.PROGRAM_OFFICE,
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          userId: APPLICANT_ID,
          name: 'Synthetic user',
          studentId: '800002',
          department: 'Synthetic department',
          type: MemberKind.STUDENT,
          departmentType: DepartmentType.DEPARTMENT,
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ].map(({ userId, ...profile }) =>
        prisma.user.update({ where: { id: userId }, data: profile }),
      ),
    );
  });

  afterEach(async () => {
    await prisma.teamInvitation.deleteMany({
      where: {
        programId: {
          in: [
            CREATE_PROGRAM_ID,
            ...APPLICATION_IDS.map((id) => `${id}-program`),
          ],
        },
      },
    });
    await prisma.admin.deleteMany({ where: { userId: ACTOR_ID } });
    await prisma.notification.deleteMany({
      where: { type: 'APPLICATION_DECISION' },
    });
    await prisma.repositoryIssuanceHistory.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });

    await prisma.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: {
        OR: [
          { teamId: { in: [TEAM_ID, CREATE_TEAM_ID] } },
          {
            teamId: {
              in: APPLICATION_IDS.map((id) => id),
            },
          },
          { programId: CREATE_PROGRAM_ID },
        ],
      },
    });
    await prisma.team.deleteMany({
      where: {
        OR: [
          { id: { in: [TEAM_ID, CREATE_TEAM_ID] } },
          {
            id: {
              in: APPLICATION_IDS.map((id) => id),
            },
          },
          { programId: CREATE_PROGRAM_ID },
        ],
      },
    });
    await prisma.teamHistory.deleteMany({
      where: {
        programId: {
          in: [
            CREATE_PROGRAM_ID,
            ...APPLICATION_IDS.map((id) => `${id}-program`),
          ],
        },
      },
    });
    await prisma.program.deleteMany({
      where: {
        id: {
          in: [
            ...APPLICATION_IDS.map((id) => `${id}-program`),
            CREATE_PROGRAM_ID,
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ['staff', 'APPROVE', ApplicationStatus.SUBMITTED],
    ['staff', 'REJECT', ApplicationStatus.APPROVED],
    ['staff', 'REVERT', ApplicationStatus.REJECTED],
    ['admin', 'APPROVE', ApplicationStatus.SUBMITTED],
    ['admin', 'REJECT', ApplicationStatus.APPROVED],
    ['admin', 'REVERT', ApplicationStatus.REJECTED],
  ] as const)(
    '%s cannot %s its current team application',
    async (role, action, status) => {
      const teamId = 'synthetic-enabled-application';
      await createApplication(teamId, true);
      await prisma.user.update({
        where: { id: ACTOR_ID },
        data: {
          type: role === 'staff' ? 'STAFF' : 'STUDENT',
          approvalStatus: role === 'staff' ? 'APPROVED' : 'NOT_REQUIRED',
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: 'DEPARTMENT',
          ...(role === 'admin'
            ? { admin: { create: { origin: 'MIGRATION' as const } } }
            : {}),
        },
      });
      await prisma.teamMember.create({
        data: {
          teamId: teamId,
          programId: `${teamId}-program`,
          userId: ACTOR_ID,
        },
      });
      await prisma.team.update({
        where: { id: teamId },
        data: { status },
      });
      const before = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
      });
      const auditCount = await prisma.auditLog.count({
        where: { targetId: teamId },
      });
      const notificationWhere = {
        type: 'APPLICATION_DECISION' as const,
        payload: { path: ['teamId'], equals: teamId },
      };
      const notificationCount = await prisma.notification.count({
        where: notificationWhere,
      });

      await expect(
        service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
          action,
          reason: 'synthetic reason',
        }),
      ).rejects.toMatchObject({ errorCode: { code: 'APP_029', status: 403 } });

      await expect(
        prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
      ).resolves.toEqual(before);
      await expect(
        prisma.auditLog.count({ where: { targetId: teamId } }),
      ).resolves.toBe(auditCount);
      await expect(
        prisma.teamHistory.count({ where: { teamId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.notification.count({ where: notificationWhere }),
      ).resolves.toBe(notificationCount);
      await expect(
        prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
      ).resolves.toBe(0);
      await prisma.user.update({
        where: { id: ACTOR_ID },
        data: {
          type: 'STAFF',
          approvalStatus: 'APPROVED',
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: 'DEPARTMENT',
        },
      });
    },
  );

  it.each([
    {
      name: '잠금 후 최신 양식으로 신청',
      policy: { applicationTemplateVersion: 2 },
      submittedVersion: 2,
      errorCode: null,
    },
    {
      name: '신청 종료일 변경',
      policy: { applicationEndAt: new Date('2026-07-14T00:00:00.000Z') },
      submittedVersion: 1,
      errorCode: ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    },
    {
      name: '신청 시작일 변경',
      policy: { applicationStartAt: new Date('2026-07-16T00:00:00.000Z') },
      submittedVersion: 1,
      errorCode: ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    },
    {
      name: '오래된 신청 양식',
      policy: { applicationTemplateVersion: 2 },
      submittedVersion: 1,
      errorCode: ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH,
    },
    {
      name: '프로그램 보관 전환',
      policy: { lifecycle: ProgramLifecycle.ARCHIVED },
      submittedVersion: 1,
      errorCode: ApplicationsErrorCode.PROGRAM_ARCHIVED,
    },
  ])(
    '편집 잠금 대기 후 $name',
    async ({ policy, submittedVersion, errorCode }) => {
      await prisma.program.create({
        data: {
          startAt: new Date('2026-07-01T00:00:00.000Z'),
          endAt: new Date(
            new Date('2026-07-31T23:59:59.000Z').getTime() + 365 * 86400000,
          ),
          id: CREATE_PROGRAM_ID,
          name: 'synthetic-policy-program',
          organizer: 'synthetic-organizer',
          category: ProgramCategory.BASIC,
          lifecycle: ProgramLifecycle.PUBLISHED,
          applicationTemplateKey: 'synthetic-template',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
          description: 'synthetic-description',
        },
      });
      const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
      databaseUrl.searchParams.set('connection_limit', '1');
      const applicantPrisma = new PrismaService({
        datasources: { db: { url: databaseUrl.toString() } },
      });
      const applicantService = new TeamApplicationService(
        new ApplicationsRepository(
          applicantPrisma,
          new TeamHistoryRepository(),
          new RepositoryProvisionGenerationRepository(),
          new PlatformRepository(),
        ),
        new RepositoryUrlService(),
        new ApplicationAnswersService(),
        new RepositoryProvisionEventService(),
      );
      let releaseEditor!: () => void;
      const editorRelease = new Promise<void>((resolve) => {
        releaseEditor = resolve;
      });
      let markEditorReady!: (pid: number) => void;
      const editorReady = new Promise<number>((resolve) => {
        markEditorReady = resolve;
      });
      const auditCount = await prisma.auditLog.count({
        where: { actorId: APPLICANT_ID },
      });
      const editor = prisma.$transaction(
        async (transaction) => {
          await transaction.program.update({
            where: { id: CREATE_PROGRAM_ID },
            data: policy,
          });
          const [connection] = await transaction.$queryRaw<
            [{ pid: number }]
          >`SELECT pg_backend_pid() AS pid`;
          markEditorReady(connection.pid);
          await editorRelease;
        },
        { timeout: 10_000 },
      );
      const editorOutcome = editor.then(
        () => ({ status: 'fulfilled' as const }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
      let application: Promise<unknown> | undefined;
      try {
        const editorPid = await Promise.race([
          editorReady,
          editorOutcome.then(() => {
            throw new Error('Editor ended before acquiring the Program lock');
          }),
        ]);
        const [applicantConnection] = await applicantPrisma.$queryRaw<
          [{ pid: number }]
        >`SELECT pg_backend_pid() AS pid`;
        application = applicantService
          .create(
            APPLICANT_GITHUB_ID,
            CREATE_PROGRAM_ID,
            {
              answers: { title: '합성 신청 제목' },
              teamName: null,
              applicationTemplateVersion: submittedVersion,
              isRepositoryPublicationPlanned: true,
            },
            new Date('2026-07-15T00:00:00.000Z'),
          )
          .then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          );
        const deadline = Date.now() + 4_000;
        let waiting = false;
        while (!waiting) {
          const [state] = await prisma.$queryRaw<[{ waiting: boolean }]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE pid = ${applicantConnection.pid}
              AND wait_event_type = 'Lock'
              AND ${editorPid} = ANY(pg_blocking_pids(pid))
          ) AS waiting`;
          waiting = state.waiting;
          if (!waiting && Date.now() >= deadline) {
            throw new Error(
              'Applicant did not wait for the editor-held Program lock',
            );
          }
        }
        expect(waiting).toBe(true);
        releaseEditor();
        expect(await editorOutcome).toEqual({ status: 'fulfilled' });
        const outcome = await application;
        if (errorCode !== null) {
          expect(outcome).toMatchObject({
            status: 'rejected',
            reason: { errorCode: { code: errorCode } },
          });
          expect(
            await prisma.team.count({
              where: { programId: CREATE_PROGRAM_ID },
            }),
          ).toBe(0);
          expect(
            await prisma.team.count({
              where: { programId: CREATE_PROGRAM_ID },
            }),
          ).toBe(0);
          expect(
            await prisma.teamMember.count({
              where: { programId: CREATE_PROGRAM_ID },
            }),
          ).toBe(0);
          expect(
            await prisma.teamHistory.count({
              where: { actorId: APPLICANT_ID },
            }),
          ).toBe(auditCount);
        } else {
          expect(outcome).toMatchObject({ status: 'fulfilled' });
          const applications = await prisma.team.findMany({
            where: { programId: CREATE_PROGRAM_ID },
          });
          expect(applications).toHaveLength(1);
          expect(applications[0]).toMatchObject({
            applicationTemplateVersion: 2,
            status: ApplicationStatus.SUBMITTED,
          });
          expect(
            await prisma.team.count({
              where: { programId: CREATE_PROGRAM_ID },
            }),
          ).toBe(1);
          expect(
            await prisma.teamHistory.count({
              where: { actorId: APPLICANT_ID },
            }),
          ).toBe(auditCount + 1);
        }
      } finally {
        releaseEditor();
        await editorOutcome;
        await application;
        await applicantPrisma.$disconnect();
      }
    },
    15_000,
  );

  it('최소 2명 프로그램에 학생을 지명해 지원하고 수락 후에만 승인한다', async () => {
    await prisma.program.create({
      data: {
        startAt: new Date('2026-01-01T00:00:00.000Z'),
        endAt: new Date(
          new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
        ),
        id: CREATE_PROGRAM_ID,
        name: 'synthetic-create-program',
        organizer: 'synthetic-organizer',
        category: ProgramCategory.CAPSTONE,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: 'synthetic-description',
        teamMinSize: 2,
        teamMaxSize: 4,
        repositoryProvisioningEnabled: false,
      },
    });

    const application = await service.create(
      8_000_000_000_002n,
      CREATE_PROGRAM_ID,
      {
        answers: { title: '팀 제목' },
        inviteeUserIds: ['synthetic-decision-member'],
        teamName: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

    await expect(
      service.decide(
        { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
        application.id,
        { action: APPLICATION_DECISION_ACTIONS.APPROVE },
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET,
        status: 422,
      },
      extensions: { memberCount: 1, teamMinSize: 2 },
    });
    expect(
      await prisma.team.findUnique({
        where: { id: application.id },
        select: { status: true },
      }),
    ).toEqual({ status: ApplicationStatus.SUBMITTED });
    const invitations = new TeamInvitationsRepository(
      new TeamHistoryRepository(),
      prisma,
      new PlatformRepository(),
    );
    const invited = await prisma.teamInvitation.findFirstOrThrow({
      where: {
        teamId: application.teamId,
        inviteeId: 'synthetic-decision-member',
      },
    });
    expect(
      await invitations.withAcceptTransaction(
        invited.id,
        'synthetic-decision-member',
      ),
    ).toEqual({
      kind: 'ok',
      teamId: application.teamId,
      programId: CREATE_PROGRAM_ID,
    });
    await expect(
      service.decide(
        { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
        application.id,
        { action: APPLICATION_DECISION_ACTIONS.APPROVE },
      ),
    ).resolves.toMatchObject({ kind: 'APPROVED' });
    expect(
      await prisma.teamMember.count({
        where: { teamId: application.teamId },
      }),
    ).toBe(2);
  });
  it.each(['leave', 'accept'] as const)(
    '%s 중 승인은 커밋된 팀 구성원을 사용한다',
    async (change) => {
      const teamId = APPLICATION_IDS[0];
      const programId = `${teamId}-program`;
      await createApplication(teamId, change === 'accept');
      await prisma.program.update({
        where: { id: programId },
        data: { teamMinSize: 2, teamMaxSize: 2 },
      });
      if (change === 'leave') {
        await prisma.teamMember.create({
          data: { teamId, programId, userId: 'synthetic-decision-member' },
        });
      }
      const url = new URL(process.env.DATABASE_URL ?? '');
      url.searchParams.set('connection_limit', '1');
      const approvalPrisma = new PrismaService({
        datasources: { db: { url: url.toString() } },
      });
      const approvalService = new TeamApplicationService(
        new ApplicationsRepository(
          approvalPrisma,
          new TeamHistoryRepository(),
          new RepositoryProvisionGenerationRepository(),
          new PlatformRepository(),
        ),
        new RepositoryUrlService(),
        new ApplicationAnswersService(),
        new RepositoryProvisionEventService(),
      );
      const teams = new TeamRepository(
        prisma,
        new ProgramTeamRepositoryEvidenceRepository(prisma),
        new PlatformRepository(),
        new TeamHistoryRepository(),
      );
      const gate: { ready?: () => void; release?: () => void } = {};
      const ready = new Promise<void>((resolve) => {
        gate.ready = resolve;
      });
      const release = new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      const waitForCommit = async () => {
        gate.ready?.();
        await release;
      };
      const write: Promise<unknown> =
        change === 'leave'
          ? teams.leave(programId, 'synthetic-decision-member', waitForCommit)
          : (async () => {
              const pending = await prisma.teamInvitation.create({
                data: {
                  teamId,
                  programId,
                  invitedById: APPLICANT_ID,
                  inviteeId: 'synthetic-decision-member',
                },
              });
              return new TeamInvitationsRepository(
                new TeamHistoryRepository(),
                prisma,
                new PlatformRepository(),
              ).withAcceptTransaction(
                pending.id,
                'synthetic-decision-member',
                new Date(),
                waitForCommit,
              );
            })();
      const mutation = write.then(
        (value) => ({ kind: 'completed' as const, value }),
        (error: unknown) => ({ kind: 'failed' as const, error }),
      );
      let approval: Promise<unknown> | undefined;
      try {
        await Promise.race([
          ready,
          mutation.then(() => {
            throw new Error(
              'Membership change ended before acquiring the team lock',
            );
          }),
        ]);
        const [connection] = await approvalPrisma.$queryRaw<
          [{ pid: number }]
        >`SELECT pg_backend_pid() AS pid`;
        approval = approvalService
          .decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
            action: APPLICATION_DECISION_ACTIONS.APPROVE,
          })
          .then(
            (value) => ({ kind: 'approved' as const, value }),
            (error: unknown) => ({ kind: 'refused' as const, error }),
          );
        const deadline = Date.now() + 4000;
        while (true) {
          const [state] = await prisma.$queryRaw<[{ waiting: boolean }]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE pid = ${connection.pid} AND wait_event_type = 'Lock'
              AND cardinality(pg_blocking_pids(pid)) > 0
          ) AS waiting`;
          if (state.waiting) break;
          if (Date.now() >= deadline)
            throw new Error(
              'Approval did not wait for the membership transaction',
            );
        }
        gate.release?.();
        if (change === 'leave') {
          expect(await mutation).toEqual({
            kind: 'completed',
            value: 'removed',
          });
          expect(await approval).toMatchObject({
            kind: 'refused',
            error: {
              errorCode: { code: ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET },
              extensions: { memberCount: 1, teamMinSize: 2 },
            },
          });
          expect(
            await prisma.team.findUnique({
              where: { id: teamId },
              select: { status: true },
            }),
          ).toEqual({ status: ApplicationStatus.SUBMITTED });
          expect(
            await prisma.teamHistory.count({
              where: { teamId },
            }),
          ).toBe(0);
          expect(
            await prisma.outboxEvent.count({
              where: { aggregateId: teamId },
            }),
          ).toBe(0);
        } else {
          expect(await mutation).toMatchObject({
            kind: 'completed',
            value: { kind: 'ok' },
          });
          expect(await approval).toMatchObject({
            kind: 'approved',
            value: { kind: 'APPROVED' },
          });
          const event = await prisma.outboxEvent.findFirstOrThrow({
            where: { aggregateId: teamId },
          });
          expect(event.payload).toMatchObject({
            collaboratorGithubLogins: [
              'synthetic-applicant',
              'synthetic-member',
            ],
          });
        }
      } finally {
        gate.release?.();
        await mutation;
        await approval;
        await approvalPrisma.$disconnect();
      }
    },
    15_000,
  );

  it('신청을 승인하면 같은 트랜잭션에 outbox를 남긴다', async () => {
    const teamId = APPLICATION_IDS[0];
    await createApplication(teamId, true);

    const result = await service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    const application = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${teamId}` },
    });
    expect(application).toMatchObject({
      status: ApplicationStatus.APPROVED,
      processedById: ACTOR_ID,
    });
    expect(application.processedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: event.id,
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    expect(event.payload).toMatchObject({
      teamId,
      programId: `${teamId}-program`,
      requestedAt: application.processedAt?.toISOString(),
      collaboratorGithubLogins: ['synthetic-applicant'],
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      currentEventId: event.id,
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });

    const history = await prisma.teamHistory.findFirstOrThrow({
      where: { teamId, event: 'APPROVED' },
    });
    expect(history).toMatchObject({
      actorId: ACTOR_ID,
      programId: `${teamId}-program`,
      event: 'APPROVED',
      occurredAt: application.processedAt,
    });
    expect(history.data).toEqual({
      schemaVersion: 1,
      revision: 1,
      rejectionReason: null,
    });
    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        userId: APPLICANT_ID,
        type: 'APPLICATION_DECISION',
        status: 'UNREAD',
      },
    });
    expect(notification).toMatchObject({
      channel: 'IN_APP',
      payload: {
        schemaVersion: 1,
        teamId,
        programId: `${teamId}-program`,
        programName: `program-${teamId}`,
        decision: ApplicationStatus.APPROVED,
        decidedAt: application.processedAt?.toISOString(),
      },
    });
  });

  it('삭제된 프로그램의 신청 승인을 거절하고 상태와 기록을 보존한다', async () => {
    const teamId = APPLICATION_IDS[0];
    await createApplication(teamId, true);
    await prisma.program.update({
      where: { id: `${teamId}-program` },
      data: { lifecycle: ProgramLifecycle.DELETED },
    });
    const before = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
    });

    await expect(
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.APPLICATION_NOT_FOUND },
    });
    expect(
      await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
      }),
    ).toEqual(before);
    expect(await prisma.teamHistory.count({ where: { teamId } })).toBe(0);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).toBe(0);
  });

  it('저장소 기능이 꺼진 프로그램은 승인하고 outbox를 만들지 않는다', async () => {
    const teamId = APPLICATION_IDS[1];
    await createApplication(teamId, false);

    const result = await service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    expect(result).toMatchObject({
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: false,
        eventId: null,
        jobStatus: null,
      },
    });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).resolves.toBe(0);
  });

  it('팀 승인은 팀장과 팀원을 정규화한 snapshot으로 고정한다', async () => {
    const teamId = APPLICATION_IDS[0];
    const programId = `${teamId}-program`;
    await createApplication(teamId, true);
    await prisma.teamMember.create({
      data: {
        teamId,
        programId,
        userId: 'synthetic-decision-member',
      },
    });

    await service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${teamId}` },
    });
    expect(event.payload).toMatchObject({
      teamId,
      collaboratorGithubLogins: ['synthetic-applicant', 'synthetic-member'],
    });
    await expect(
      prisma.notification.count({
        where: { type: 'APPLICATION_DECISION' },
      }),
    ).resolves.toBe(2);
  });

  it('반려는 사유를 저장하고 outbox를 만들지 않는다', async () => {
    const teamId = APPLICATION_IDS[2];
    await createApplication(teamId, true);

    await service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });
    const application = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
    });

    expect(application).toMatchObject({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      processedById: ACTOR_ID,
    });
    expect(application.processedAt).toBeInstanceOf(Date);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).resolves.toBe(0);
    const rejectedNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: APPLICANT_ID, type: 'APPLICATION_DECISION' },
    });
    expect(rejectedNotification.payload).toMatchObject({
      teamId,
      decision: ApplicationStatus.REJECTED,
    });
  });

  it('동시 승인은 상태와 idempotencyKey 기준 이벤트 한 건으로 수렴한다', async () => {
    const teamId = APPLICATION_IDS[3];
    await createApplication(teamId, true);

    const decisions = await Promise.allSettled([
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ]);

    expect(
      decisions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      decisions.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      prisma.outboxEvent.count({
        where: { idempotencyKey: `repository-provision:${teamId}` },
      }),
    ).resolves.toBe(1);
  });

  it('동시 반려는 CAS 승자 하나만 이력·알림을 남기고 패자는 부수효과가 0이다', async () => {
    const teamId = APPLICATION_IDS[4];
    await createApplication(teamId, false);

    const decisions = await Promise.allSettled([
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유 A',
      }),
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유 B',
      }),
    ]);

    expect(
      decisions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejectionEvents = await prisma.teamHistory.count({
      where: { teamId, event: 'REJECTED' },
    });
    expect(rejectionEvents).toBe(1);
    const notifications = await prisma.notification.count({
      where: {
        type: 'APPLICATION_DECISION',
        payload: { path: ['teamId'], equals: teamId },
      },
    });

    expect(notifications).toBe(1);
  });

  it('남은 미완료 요청은 지우고 새 이벤트를 발행한다 — 먱등키 충돌 없음', async () => {
    const teamId = APPLICATION_IDS[4];
    await createApplication(teamId, true);
    const existing = await prisma.outboxEvent.create({
      data: {
        type: 'REPOSITORY_PROVISION_REQUESTED',
        aggregateType: 'Team',
        aggregateId: teamId,
        idempotencyKey: `repository-provision:${teamId}`,
        payload: {
          teamId,
          programId: `${teamId}-program`,
          requestedAt: new Date('2026-09-17T00:00:00.000Z').toISOString(),
          collaboratorGithubLogins: ['synthetic-applicant'],
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
        },
      },
    });

    const decision = service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    const approved = await decision;
    expect(approved).toMatchObject({
      kind: 'APPROVED',
      repositoryProvisioning: { enabled: true },
    });
    expect(
      approved.kind === 'APPROVED'
        ? approved.repositoryProvisioning.eventId
        : null,
    ).not.toBe(existing.id);
    await expect(
      prisma.repositoryIssuanceHistory.findUniqueOrThrow({
        where: { requestId: existing.id },
      }),
    ).resolves.toMatchObject({
      teamId,
      connectionMode: RepositoryConnectionMode.NEW,
      outcome: RepositoryIssuanceOutcome.DISCARDED,
    });
    await expect(
      prisma.repositoryIssuanceHistory.count({
        where: { requestId: existing.id },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.APPROVED });
    await expect(
      prisma.outboxEvent.count({
        where: { idempotencyKey: `repository-provision:${teamId}` },
      }),
    ).resolves.toBe(1);
  });

  it('이미 판정된 신청은 409와 최신 상태를 반환한다', async () => {
    const teamId = APPLICATION_IDS[5];
    await createApplication(teamId, false);
    await prisma.team.update({
      where: { id: teamId },
      data: { status: ApplicationStatus.APPROVED },
    });

    const decision = service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
        status: 409,
      },
      extensions: { latestStatus: ApplicationStatus.APPROVED },
    });
  });

  it('#1272 승인→반려: 직접 전이하고 미완료 요청을 같은 트랜잭션에서 지운다', async () => {
    const teamId = APPLICATION_IDS[8];
    await createApplication(teamId, true);
    await service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).resolves.toBe(1);

    const result = await service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 재판정 사유',
      },
    );

    expect(result).toMatchObject({
      kind: 'REJECTED',
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 재판정 사유',
    });
    await expect(
      prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    ).resolves.toMatchObject({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 재판정 사유',
      processedById: ACTOR_ID,
    });

    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).resolves.toBe(0);

    const history = await prisma.teamHistory.findMany({
      where: { teamId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(history.map((row) => row.event)).toEqual(['APPROVED', 'REJECTED']);
    expect(history.find((row) => row.event === 'REJECTED')?.data).toMatchObject(
      { rejectionReason: '합성 재판정 사유', revision: 1 },
    );
    await expect(
      prisma.notification.count({
        where: {
          userId: APPLICANT_ID,
          type: 'APPLICATION_DECISION',
        },
      }),
    ).resolves.toBe(2);
  });

  it('#1272 반려→승인: 직접 전이하고 새 프로비저닝 이벤트를 발행한다', async () => {
    const teamId = APPLICATION_IDS[9];
    await createApplication(teamId, true);
    await service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    const result = await service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${teamId}` },
    });
    expect(result).toMatchObject({
      kind: 'APPROVED',
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: event.id,
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    const application = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
    });
    expect(application).toMatchObject({
      status: ApplicationStatus.APPROVED,
      processedById: ACTOR_ID,
    });

    expect(application.rejectionReason).toBeNull();
  });

  it('프로비저닝이 끝난 승인도 반려·되돌림·재승인이 다 되고 완료된 요청은 보존된다', async () => {
    const teamId = APPLICATION_IDS[10];
    await createApplication(teamId, true);
    await service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await prisma.repositoryProvisionJob.update({
      where: { teamId },
      data: { status: RepositoryProvisionJobStatus.SUCCEEDED },
    });
    const provisionedJob =
      await prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      });
    const provisionedEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${teamId}` },
    });

    await expect(
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      }),
    ).resolves.toMatchObject({ kind: 'REJECTED' });

    await expect(
      prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.REJECTED });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      id: provisionedJob.id,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: `repository-provision:${teamId}` },
      }),
    ).resolves.toMatchObject({ id: provisionedEvent.id });

    await expect(
      service.decide({ id: ACTOR_ID, githubId: ACTOR_GITHUB_ID }, teamId, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      }),
    ).resolves.toMatchObject({ kind: 'REVERTED' });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({ id: provisionedJob.id });

    const reapproved = await service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    expect(reapproved).toMatchObject({
      kind: 'APPROVED',
      repositoryProvisioning: {
        enabled: true,
        eventId: provisionedEvent.id,
        jobStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      },
    });
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: teamId, aggregateType: 'Team' },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      id: provisionedJob.id,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    });

    const history = await prisma.teamHistory.findMany({
      where: { teamId },
      orderBy: { occurredAt: 'asc' },
      select: { event: true, data: true },
    });
    expect(history.map((row) => row.event)).toEqual([
      'APPROVED',
      'REJECTED',
      'REVERTED',
      'APPROVED',
    ]);

    for (const row of history) expect(row.data).toMatchObject({ revision: 1 });
  });

  it('판정 사전 조회 후 학생 취소가 먼저 완료되면 404를 반환한다', async () => {
    const teamId = APPLICATION_IDS[6];
    await createApplication(teamId, false);
    const originalWithTransaction = repository.withTransaction.bind(repository);
    let releaseDecision: (() => void) | undefined;
    const decisionGate = new Promise<void>((resolve) => {
      releaseDecision = resolve;
    });
    let markDecisionReady: (() => void) | undefined;
    const decisionReady = new Promise<void>((resolve) => {
      markDecisionReady = resolve;
    });
    jest
      .spyOn(repository, 'withTransaction')
      .mockImplementationOnce((operation) =>
        originalWithTransaction((store) =>
          operation({
            auditLogWriter: store.auditLogWriter,
            findTeamMinSize: (id) => store.findTeamMinSize(id),
            countTeamMembers: (id) => store.countTeamMembers(id),
            isCurrentTeamMember: (teamId, userId) =>
              store.isCurrentTeamMember(teamId, userId),
            appendReviewHistory: (input) => store.appendReviewHistory(input),
            findApplicationById: async (id) => {
              markDecisionReady?.();
              await decisionGate;
              return store.findApplicationById(id);
            },
            discardRepositoryProvisionRequest: (
              id,
              discardedAt,
              parsePayload,
            ) =>
              store.discardRepositoryProvisionRequest(
                id,
                discardedAt,
                parsePayload,
              ),
            findRepositoryProvisionJob: (id) =>
              store.findRepositoryProvisionJob(id),
            findRepositoryProvisionEvent: (key) =>
              store.findRepositoryProvisionEvent(key),
            transitionApplication: (input) =>
              store.transitionApplication(input),
            createApplicationDecisionNotifications: (input) =>
              store.createApplicationDecisionNotifications(input),
            createRepositoryProvisionEvent: (input, parsePayload) =>
              store.createRepositoryProvisionEvent(input, parsePayload),
          }),
        ),
      );

    const decision = service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );
    await decisionReady;
    await studentService.cancelMine(
      APPLICANT_GITHUB_ID,
      `${teamId}-program`,
      new Date('2026-07-15T00:00:00.000Z'),
    );
    releaseDecision?.();

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });
  it('없는 신청은 404로 거부한다', async () => {
    const decision = service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      'synthetic-missing-application',
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });

  it('알림 기록 뒤 판정 트랜잭션 실패는 상태·감사·알림을 모두 롤백한다', async () => {
    const teamId = APPLICATION_IDS[7];
    await createApplication(teamId, true);
    const originalWithTransaction = repository.withTransaction.bind(repository);
    jest
      .spyOn(repository, 'withTransaction')
      .mockImplementationOnce((operation) =>
        originalWithTransaction((store) =>
          operation({
            auditLogWriter: store.auditLogWriter,
            findTeamMinSize: (id) => store.findTeamMinSize(id),
            countTeamMembers: (id) => store.countTeamMembers(id),
            isCurrentTeamMember: (teamId, userId) =>
              store.isCurrentTeamMember(teamId, userId),
            appendReviewHistory: (input) => store.appendReviewHistory(input),
            findApplicationById: (id) => store.findApplicationById(id),
            discardRepositoryProvisionRequest: (
              id,
              discardedAt,
              parsePayload,
            ) =>
              store.discardRepositoryProvisionRequest(
                id,
                discardedAt,
                parsePayload,
              ),
            findRepositoryProvisionJob: (id) =>
              store.findRepositoryProvisionJob(id),
            findRepositoryProvisionEvent: (key) =>
              store.findRepositoryProvisionEvent(key),
            transitionApplication: (input) =>
              store.transitionApplication(input),
            createApplicationDecisionNotifications: async (input) => {
              await store.createApplicationDecisionNotifications(input);
              throw new Error('synthetic post-notification failure');
            },
            createRepositoryProvisionEvent: (input, parsePayload) =>
              store.createRepositoryProvisionEvent(input, parsePayload),
          }),
        ),
      );

    const decision = service.decide(
      { id: ACTOR_ID, githubId: ACTOR_GITHUB_ID },
      teamId,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.DECISION_TRANSACTION_FAILED,
        status: 500,
      },
    });
    await expect(
      prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.SUBMITTED });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.notification.count({ where: { type: 'APPLICATION_DECISION' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { targetType: 'APPLICATION', targetId: teamId },
      }),
    ).resolves.toBe(0);
  });
});
