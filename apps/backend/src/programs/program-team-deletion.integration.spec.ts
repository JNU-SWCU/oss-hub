import { TeamHistoryRepository } from './team-history.repository';
import { StudentRepositoryUrlService } from './team-application.service';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import {
  TeamDeletionScopeRepository,
  ProgramTeamDeletionRepository,
  TeamRepository,
} from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  TeamHistoryEvent,
  ApplicationStatus,
  SubmissionHistoryEvent,
  ProgramCategory,
  ProgramTrackType,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  FileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { TeamsErrorCode } from './teams.error';
import { TeamMembershipService } from './team-membership.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './submissions.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'synthetic-team-deletion:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const OTHER_PROGRAM_ID = `${TEST_PREFIX}other-program`;
const MILESTONE_ID = `${TEST_PREFIX}milestone`;
const MILESTONE_DOCUMENT_ID = `${TEST_PREFIX}milestone-document`;

const STAFF_ID = `${TEST_PREFIX}staff`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const MEMBER_ID = `${TEST_PREFIX}member`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const SECOND_INVITEE_ID = `${TEST_PREFIX}second-invitee`;

const STAFF_GITHUB_ID = 9_460_000_001n;
const LEADER_GITHUB_ID = 9_460_000_002n;
const MEMBER_GITHUB_ID = 9_460_000_003n;
const INVITEE_GITHUB_ID = 9_460_000_004n;

const GITHUB_ID_BY_USER: ReadonlyMap<string, bigint> = new Map([
  [STAFF_ID, STAFF_GITHUB_ID],
  [LEADER_ID, LEADER_GITHUB_ID],
  [MEMBER_ID, MEMBER_GITHUB_ID],
  [INVITEE_ID, INVITEE_GITHUB_ID],
  [SECOND_INVITEE_ID, 9_460_000_005n],
]);

const RUN_PREFIX = `${TEST_PREFIX}run-${randomUUID()}:`;

const prisma = new PrismaService();
const deletionRepository = new ProgramTeamDeletionRepository(
  new TeamHistoryRepository(),
  prisma,
  new TeamDeletionScopeRepository(),
  new PrismaSerializationRetryRepository(),
);

const service = new TeamMembershipService(
  new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ),
  deletionRepository,
  new HistoryMetadataService(),
  new RepositoryPublishService(),
  new RepositoryUrlService(),
  new MilestoneCompletionService(),
  new StudentRepositoryUrlService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ),
);

let teamSequence = 0;

interface SeededTeam {
  readonly teamId: string;
  readonly submissionId: string;
  readonly historyId: string;
  readonly reviewHistoryId: string;
  readonly fileId: string;
  readonly repositoryId: string;
  readonly decisionNotificationId: string;
  readonly acknowledgedNotificationId: string;
  readonly outboxEventId: string;
}

beforeAll(async () => {
  await prisma.$connect();
  await seedDurableFixturesOnce();
}, DATABASE_CONNECTION_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanupTeamScope();
});

async function cleanupTeamScope(): Promise<void> {
  await prisma.teamHistory.deleteMany({
    where: { teamId: { startsWith: TEST_PREFIX } },
  });
  await prisma.notification.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { idempotencyKey: { startsWith: TEST_PREFIX } },
  });
  await prisma.file.deleteMany({
    where: { kind: 'SUBMISSION', uploaderId: { startsWith: TEST_PREFIX } },
  });
  await prisma.submissionHistory.deleteMany({
    where: { actorId: { startsWith: TEST_PREFIX } },
  });
  await prisma.submission.deleteMany({
    where: { submittedById: { startsWith: TEST_PREFIX } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { teamId: { startsWith: TEST_PREFIX } },
  });
  await prisma.contribution.deleteMany({
    where: { repositoryId: { startsWith: TEST_PREFIX } },
  });
  await prisma.repositoryInvitation.deleteMany({
    where: { repositoryId: { startsWith: TEST_PREFIX } },
  });
  await prisma.githubRepository.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamInvitation.deleteMany({
    where: { inviteeId: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({
    where: { leaderId: { startsWith: TEST_PREFIX } },
  });
}

async function seedDurableFixturesOnce(): Promise<void> {
  for (const [userId, githubId] of GITHUB_ID_BY_USER) {
    if ((await prisma.user.count({ where: { id: userId } })) > 0) continue;
    await prisma.user.create({
      data: canonicalUserCreateFromLabel(
        userId === STAFF_ID ? 'STAFF' : 'STUDENT',
        {
          id: userId,
          githubId,
          nickname: `synthetic-${userId.slice(TEST_PREFIX.length)}`,
          name: 'Synthetic user',
        },
      ),
    });
  }
  for (const programId of [PROGRAM_ID, OTHER_PROGRAM_ID]) {
    await prisma.program.upsert({
      where: { id: programId },
      update: {},
      create: {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        endAt: new Date(
          new Date('2026-08-31T00:00:00.000Z').getTime() + 365 * 86400000,
        ),
        id: programId,
        name: `Team deletion program ${programId}`,
        organizer: 'Synthetic organizer',
        trackType: ProgramTrackType.CURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
        description: 'Synthetic team deletion fixture',
        teamMinSize: 1,
        teamMaxSize: 4,
      },
    });
  }
  await prisma.milestone.upsert({
    where: { id: MILESTONE_ID },
    update: {},
    create: {
      startAt: new Date('2026-08-01T00:00:00.000Z'),

      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: 'Synthetic milestone',
      dueAt: new Date('2026-09-30T00:00:00.000Z'),
    },
  });
  await prisma.requirement.upsert({
    where: { id: MILESTONE_DOCUMENT_ID },
    update: {},
    create: {
      id: MILESTONE_DOCUMENT_ID,
      milestoneId: MILESTONE_ID,
      name: 'Synthetic document',
      required: true,
      sortOrder: 1,
    },
  });
}

async function seedApprovedTeam(
  programId: string = PROGRAM_ID,
): Promise<SeededTeam> {
  teamSequence += 1;
  const teamId = `${RUN_PREFIX}team-${teamSequence}`;
  const submissionId = `${teamId}:submission`;
  const historyId = `${teamId}:history`;
  const reviewHistoryId = `${teamId}:review`;
  const repositoryId = `${TEST_PREFIX}repository-${teamSequence}`;
  const invitationId = `${teamId}:invitation`;

  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `Team ${teamSequence}`,
      leaderId: LEADER_ID,
      applicantId: LEADER_ID,
      answers: { title: `Team ${teamSequence}` },
      applicationTemplateVersion: 1,
    },
  });
  for (const userId of [LEADER_ID, MEMBER_ID]) {
    await prisma.teamMember.create({
      data: { teamId, programId, userId },
    });
  }
  await prisma.teamInvitation.create({
    data: {
      id: invitationId,
      teamId,
      programId,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId: LEADER_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedById: STAFF_ID,
      processedAt: new Date('2026-08-10T00:00:00.000Z'),
    },
  });

  if (programId === PROGRAM_ID) {
    await prisma.submission.create({
      data: {
        id: submissionId,
        requirementId: MILESTONE_DOCUMENT_ID,
        teamId,
        submittedById: LEADER_ID,
        revision: 1,
        status: SubmissionStatus.SUBMITTED,
        histories: {
          create: {
            id: historyId,
            event: SubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorId: LEADER_ID,
          },
        },
      },
    });
    await prisma.submissionHistory.create({
      data: {
        id: reviewHistoryId,
        submissionId: submissionId,
        event: 'APPROVED',
        actorId: STAFF_ID,
        revision: (
          await prisma.submissionHistory.findUniqueOrThrow({
            where: { id: historyId },
            select: { revision: true },
          })
        ).revision,
      },
    });
    await prisma.file.create({
      data: {
        kind: 'SUBMISSION',
        id: `${teamId}:file`,
        uploaderId: LEADER_ID,
        teamId,
        submissionId: submissionId,
        submissionHistoryId: historyId,
        requirementId: MILESTONE_DOCUMENT_ID,
        lifecycle: FileLifecycle.ATTACHED,
        pendingExpiresAt: null,
        expiresAt: new Date('2099-12-31T00:00:00.000Z'),
        storageKey: `${teamId}/synthetic.pdf`,
        originalFileName: 'synthetic.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
  }

  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      githubRepositoryId: BigInt(940000000 + teamSequence),
      nameWithOwner: `synthetic-org/team-${teamSequence}`,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: RepositoryVisibility.PUBLIC,
      teamId,
      publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
  });

  await prisma.contribution.create({
    data: {
      repositoryId,
      githubId: LEADER_GITHUB_ID,
      date: new Date('2026-08-21T00:00:00.000Z'),
      commitCount: 3,
    },
  });
  await prisma.repositoryProvisionJob.create({
    data: {
      id: `${teamId}:provision-job`,
      teamId,
      repositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    },
  });
  const outboxEvent = await prisma.outboxEvent.create({
    data: {
      type: 'REPOSITORY_PROVISION_REQUESTED',
      aggregateType: 'Team',
      aggregateId: teamId,
      idempotencyKey: `${TEST_PREFIX}repository-provision:${teamId}`,
      payload: { teamId },
    },
    select: { id: true },
  });
  const decisionNotification = await prisma.notification.create({
    data: {
      userId: LEADER_ID,
      type: 'APPLICATION_DECISION',
      channel: 'IN_APP',
      status: 'UNREAD',
      idempotencyKey: `${TEST_PREFIX}application-decision:${teamId}`,
      payload: {
        schemaVersion: 1,
        teamId,
        programId,
        programName: 'Synthetic',
        decision: 'APPROVED',
        decidedAt: '2026-08-10T00:00:00.000Z',
      },
    },
    select: { id: true },
  });
  const acknowledged = await prisma.notification.create({
    data: {
      userId: LEADER_ID,
      type: 'APPLICATION_DECISION_ACKNOWLEDGED',
      channel: 'IN_APP',
      status: 'READ',
      idempotencyKey: `application-decision-acknowledged:${decisionNotification.id}`,
      payload: { schemaVersion: 1, notificationId: decisionNotification.id },
    },
    select: { id: true },
  });

  return {
    teamId,
    submissionId,
    historyId,
    reviewHistoryId,
    fileId: `${teamId}:file`,
    repositoryId,
    decisionNotificationId: decisionNotification.id,
    acknowledgedNotificationId: acknowledged.id,
    outboxEventId: outboxEvent.id,
  };
}

function currentScope(teamId: string) {
  return deletionRepository.readScopeCounts(teamId);
}

it('3b staff deletion records every pending cancellation and preserves archived history', async () => {
  const fixture = await seedApprovedTeam();
  await prisma.teamInvitation.createMany({
    data: [
      {
        id: `${fixture.teamId}:second`,
        teamId: fixture.teamId,
        programId: PROGRAM_ID,
        invitedById: LEADER_ID,
        inviteeId: SECOND_INVITEE_ID,
      },
    ],
  });
  const archived = await prisma.teamHistory.create({
    data: {
      teamId: fixture.teamId,
      programId: PROGRAM_ID,
      event: 'INVITATION_ARCHIVED',
      source: 'MIGRATION',
      sourceTable: 'TeamInvitation',
      sourceId: `${fixture.teamId}:expired`,
      data: {
        schemaVersion: 1,
        invitation: {
          id: `${fixture.teamId}:expired`,
          invitedById: LEADER_ID,
          inviteeId: MEMBER_ID,
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'EXPIRED',
          respondedAt: null,
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      },
    },
  });
  const scope = await currentScope(fixture.teamId);

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    scope,
  );

  const events = await prisma.teamHistory.findMany({
    where: { teamId: fixture.teamId, sourceTable: 'TeamInvitation' },
    orderBy: { sourceId: 'asc' },
  });
  expect(
    await prisma.teamHistory.count({
      where: { teamId: fixture.teamId, event: 'DELETED' },
    }),
  ).toBe(1);
  expect(events.map((event) => event.sourceId)).toEqual([
    `${fixture.teamId}:expired`,
    `${fixture.teamId}:invitation`,
    `${fixture.teamId}:second`,
  ]);
  const cancellations = events.filter(
    (row) => row.event === 'INVITATION_CANCELLED',
  );
  expect(cancellations).toHaveLength(2);
  for (const event of cancellations) {
    expect(event).toMatchObject({
      actorId: STAFF_ID,
      event: 'INVITATION_CANCELLED',
      source: 'APPLICATION',
      data: { reason: 'TEAM_DELETED' },
    });
  }
  expect(
    events.find((event) => event.sourceId === `${fixture.teamId}:expired`),
  ).toEqual(archived);
  await expect(
    prisma.team.findUnique({ where: { id: fixture.teamId } }),
  ).resolves.toBeNull();
});

it('3a history failure rolls back staff deletion and its notifications', async () => {
  const fixture = await seedApprovedTeam();
  await prisma.teamInvitation.create({
    data: {
      id: `${fixture.teamId}:second`,
      teamId: fixture.teamId,
      programId: PROGRAM_ID,
      invitedById: LEADER_ID,
      inviteeId: SECOND_INVITEE_ID,
    },
  });
  await prisma.teamHistory.create({
    data: {
      teamId: fixture.teamId,
      programId: PROGRAM_ID,
      actorId: STAFF_ID,
      event: 'INVITATION_CANCELLED',
      source: 'APPLICATION',
      sourceTable: 'TeamInvitation',
      sourceId: `${fixture.teamId}:second`,
      data: {
        schemaVersion: 1,
        invitation: {
          id: `${fixture.teamId}:second`,
          inviteeId: SECOND_INVITEE_ID,
          invitedById: LEADER_ID,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      },
    },
  });
  const scope = await currentScope(fixture.teamId);
  const notifications = await prisma.notification.count();

  await expect(
    service.deleteForStaff(STAFF_GITHUB_ID, PROGRAM_ID, fixture.teamId, scope),
  ).rejects.toMatchObject({
    code: 'P2002',
    meta: { modelName: 'TeamHistory' },
  });

  await expect(currentScope(fixture.teamId)).resolves.toEqual(scope);
  await expect(prisma.notification.count()).resolves.toBe(notifications);
  await expect(
    prisma.teamHistory.findMany({
      where: { teamId: fixture.teamId },
      select: { sourceId: true },
    }),
  ).resolves.toEqual([{ sourceId: `${fixture.teamId}:second` }]);
  await expect(
    prisma.file.findUnique({
      where: { kind: 'SUBMISSION', id: fixture.fileId },
    }),
  ).resolves.toMatchObject({ lifecycle: 'ATTACHED' });
});

it('승인된 팀도 확인한 범위와 맞으면 팀과 그 아래가 함께 사라진다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);

  expect(expectedScope).toMatchObject({
    teams: 1,
    members: 2,
    invitations: 1,
    submissions: 1,

    submissionEvents: 3,
    detachedRepositories: 1,
  });

  await expect(
    service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
    ),
  ).resolves.toEqual({
    teamId: fixture.teamId,
    deleted: true,
    deletedCounts: {
      teams: 1,
      members: 2,
      invitations: 1,
      submissions: 1,
      submissionEvents: 3,
      detachedRepositories: 1,
    },
  });

  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.teamMember.count({ where: { teamId: fixture.teamId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.teamInvitation.count({ where: { teamId: fixture.teamId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.submission.count({
      where: { id: fixture.submissionId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.submissionHistory.count({
      where: { id: fixture.historyId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.repositoryProvisionJob.count({
      where: { teamId: fixture.teamId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.outboxEvent.count({ where: { id: fixture.outboxEventId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.notification.count({
      where: {
        id: {
          in: [
            fixture.decisionNotificationId,
            fixture.acknowledgedNotificationId,
          ],
        },
      },
    }),
  ).resolves.toBe(0);
});

it('팀 삭제는 연결 레포와 수집 기록 및 레포 초대를 함께 지운다', async () => {
  const fixture = await seedApprovedTeam();
  await prisma.collectionCommitFact.create({
    data: {
      repositoryId: fixture.repositoryId,
      sha: 'team-deletion-commit',
      committedAt: new Date('2026-08-21T00:00:00.000Z'),
    },
  });
  await prisma.repositoryInvitation.create({
    data: {
      repositoryId: fixture.repositoryId,
      githubLogin: 'synthetic-team-deletion-invitee',
    },
  });

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  await expect(
    prisma.githubRepository.findUnique({ where: { id: fixture.repositoryId } }),
  ).resolves.toBeNull();
  await expect(
    prisma.contribution.count({
      where: { repositoryId: fixture.repositoryId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.collectionCommitFact.count({
      where: { repositoryId: fixture.repositoryId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.repositoryInvitation.count({
      where: { repositoryId: fixture.repositoryId },
    }),
  ).resolves.toBe(0);
});

it('첨부 파일은 지우지 않고 DELETE_PENDING 으로 넘기며 FK 를 모두 끊는다', async () => {
  const fixture = await seedApprovedTeam();

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  const file = await prisma.file.findUniqueOrThrow({
    where: { kind: 'SUBMISSION', id: fixture.fileId },
    select: {
      lifecycle: true,
      teamId: true,
      requirementId: true,
      submissionId: true,
      submissionHistoryId: true,
      deletedAt: true,
      nextDeleteAttemptAt: true,
    },
  });
  expect(file).toMatchObject({
    lifecycle: FileLifecycle.DELETE_PENDING,
    teamId: null,
    requirementId: null,
    submissionId: null,
    submissionHistoryId: null,
    deletedAt: null,
  });

  expect(file.nextDeleteAttemptAt).not.toBeNull();
});

it('삭제 이력에는 팀 이름과 함께 실제로 사라진 수치를 남긴다', async () => {
  const fixture = await seedApprovedTeam();
  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );
  const rows = await prisma.teamHistory.findMany({
    where: { teamId: fixture.teamId, event: 'DELETED' },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorId: STAFF_ID,
    data: {
      schemaVersion: 1,
      reason: 'STAFF_DELETED',
      name: expect.stringContaining('Team ') as unknown,
      deletedCounts: {
        teams: 1,
        members: 2,
        invitations: 1,
        submissions: 1,
        submissionEvents: 3,
        detachedRepositories: 1,
      },
    },
  });
});

it('확인 이후 범위가 바뀌면 409 로 물러나고 아무것도 지우지 않는다', async () => {
  const fixture = await seedApprovedTeam();
  const staleScope = await currentScope(fixture.teamId);

  await prisma.teamInvitation.create({
    data: {
      id: `${fixture.teamId}:late-invitation`,
      teamId: fixture.teamId,
      programId: PROGRAM_ID,
      inviteeId: MEMBER_ID,
      invitedById: LEADER_ID,
    },
  });

  await expect(
    service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      staleScope,
    ),
  ).rejects.toMatchObject({
    errorCode: { code: TeamsErrorCode.TEAM_DELETE_SCOPE_CHANGED },
  });

  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
  await expect(
    prisma.teamMember.count({ where: { teamId: fixture.teamId } }),
  ).resolves.toBe(2);
});

it('409 는 화면이 다시 그릴 수 있도록 현재 범위를 함께 싣는다', async () => {
  const fixture = await seedApprovedTeam();
  const staleScope = await currentScope(fixture.teamId);
  await prisma.teamMember.deleteMany({
    where: { teamId: fixture.teamId, userId: MEMBER_ID },
  });

  try {
    await service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      staleScope,
    );
    throw new TypeError('Expected deleteForStaff to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).extensions).toMatchObject({
      currentTeamScopeCounts: { members: 1 },
    });
  }
});

it('다른 프로그램의 팀은 404 이고 그 팀은 그대로 남는다', async () => {
  const fixture = await seedApprovedTeam(OTHER_PROGRAM_ID);
  const expectedScope = await currentScope(fixture.teamId);

  await expect(
    service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
    ),
  ).rejects.toMatchObject({
    errorCode: { code: TeamsErrorCode.TARGET_TEAM_NOT_FOUND },
  });
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
});

it('없는 팀도 같은 404 다', async () => {
  await expect(
    service.deleteForStaff(STAFF_GITHUB_ID, PROGRAM_ID, `${RUN_PREFIX}ghost`, {
      teams: 0,
      members: 0,
      invitations: 0,
      submissions: 0,
      submissionEvents: 0,
      detachedRepositories: 0,
      scopeFingerprint: 'd41d8cd98f00b204e9800998ecf8427e',
    }),
  ).rejects.toMatchObject({
    errorCode: { code: TeamsErrorCode.TARGET_TEAM_NOT_FOUND },
  });
});

it('팀장은 자기 팀도 지울 수 없다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);

  await expect(
    service.deleteForStaff(
      LEADER_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
    ),
  ).rejects.toMatchObject({
    errorCode: { code: TeamsErrorCode.TEAM_DELETE_FORBIDDEN },
  });
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
});

it('팀을 지워도 발급 이력은 남고 삭제를 막지도 않는다', async () => {
  const fixture = await seedApprovedTeam();
  const requestId = `${fixture.teamId}:issuance`;
  await prisma.repositoryIssuanceHistory.create({
    data: {
      requestId,
      teamId: fixture.teamId,
      repositoryId: fixture.repositoryId,
      connectionMode: RepositoryConnectionMode.NEW,
      source: RepositorySource.ORG_PROVISIONED,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt: new Date('2026-01-01T00:01:00.000Z'),
    },
  });

  try {
    const expectedScope = await currentScope(fixture.teamId);
    await service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
    );

    await expect(
      prisma.team.count({ where: { id: fixture.teamId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.team.count({ where: { id: fixture.teamId } }),
    ).resolves.toBe(0);

    const retained = await prisma.repositoryIssuanceHistory.findUnique({
      where: { requestId },
      select: { teamId: true, outcome: true },
    });
    expect(retained).toEqual({
      teamId: fixture.teamId,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
    });
  } finally {
    await prisma.repositoryIssuanceHistory.deleteMany({ where: { requestId } });
  }
});

it('비활성 교직원도 막힌다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);
  await prisma.user.update({
    where: { id: STAFF_ID },
    data: { accountStatus: AccountStatus.DEACTIVATED },
  });

  try {
    await expect(
      service.deleteForStaff(
        STAFF_GITHUB_ID,
        PROGRAM_ID,
        fixture.teamId,
        expectedScope,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.TEAM_DELETE_FORBIDDEN },
    });
  } finally {
    await prisma.user.update({
      where: { id: STAFF_ID },
      data: { accountStatus: AccountStatus.ACTIVE },
    });
  }
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
});

function teamDeletedNotifications(teamId: string) {
  return prisma.notification.findMany({
    where: {
      type: 'TEAM_DELETED',
      idempotencyKey: { startsWith: `team-deleted:${teamId}:` },
    },
    orderBy: { userId: 'asc' },
  });
}

it.each([null, '   '])(
  '문구가 %p이면 삭제 사실만 담은 알림이 팀원 전원에게 같은 커밋으로 남는다',
  async (message) => {
    const fixture = await seedApprovedTeam();
    const expectedScope = await currentScope(fixture.teamId);

    await service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
      message,
    );

    const notifications = await teamDeletedNotifications(fixture.teamId);
    expect(notifications.map((row) => row.userId).sort()).toEqual(
      [LEADER_ID, MEMBER_ID].sort(),
    );
    expect(notifications[0]?.payload).toMatchObject({
      schemaVersion: 1,
      teamId: fixture.teamId,
      programId: PROGRAM_ID,
      message: null,
    });

    await expect(
      prisma.team.findUnique({ where: { id: fixture.teamId } }),
    ).resolves.toBeNull();
  },
);

it('삭제 이력 저장이 실패하면 팀과 알림은 변경되지 않는다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "TeamHistory" ADD CONSTRAINT "synthetic_staff_deletion_history_failure" CHECK ("teamId" <> '${fixture.teamId}' OR "event" <> 'DELETED')`,
  );
  try {
    await expect(
      service.deleteForStaff(
        STAFF_GITHUB_ID,
        PROGRAM_ID,
        fixture.teamId,
        expectedScope,
      ),
    ).rejects.toThrow('synthetic_staff_deletion_history_failure');
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "TeamHistory" DROP CONSTRAINT "synthetic_staff_deletion_history_failure"',
    );
  }
  await expect(currentScope(fixture.teamId)).resolves.toEqual(expectedScope);
  await expect(teamDeletedNotifications(fixture.teamId)).resolves.toEqual([]);
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
});

it('이미 저장한 수신자 키는 유지하고 나머지 팀원 알림만 추가한다', async () => {
  const fixture = await seedApprovedTeam();
  const existing = await prisma.notification.create({
    data: {
      userId: LEADER_ID,
      type: 'TEAM_DELETED',
      channel: 'IN_APP',
      status: 'UNREAD',
      idempotencyKey: `team-deleted:${fixture.teamId}:${LEADER_ID}`,
      payload: { schemaVersion: 1, message: 'existing notification' },
    },
  });

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  const notifications = await teamDeletedNotifications(fixture.teamId);
  expect(notifications).toHaveLength(2);
  expect(notifications.find((row) => row.userId === LEADER_ID)).toEqual(
    existing,
  );
  expect(
    notifications.find((row) => row.userId === MEMBER_ID)?.payload,
  ).toMatchObject({
    teamId: fixture.teamId,
    programId: PROGRAM_ID,
    message: null,
  });
});

it('문구를 채우면 그 문구가 알림 payload 에 함께 담긴다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    expectedScope,
    '  중복 신청이라 정리했습니다  ',
  );

  const notifications = await teamDeletedNotifications(fixture.teamId);
  expect(notifications).toHaveLength(2);
  for (const notification of notifications) {
    expect(notification.payload).toMatchObject({
      message: '중복 신청이라 정리했습니다',
    });
  }
});

it('알림 enqueue 가 실패하면 팀·신청·이력·감사가 하나도 사라지지 않는다', async () => {
  const fixture = await seedApprovedTeam();
  await prisma.teamHistory.create({
    data: {
      id: `${fixture.teamId}:review-history`,
      teamId: fixture.teamId,
      actorId: STAFF_ID,
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
      programId: PROGRAM_ID,
      event: TeamHistoryEvent.APPROVED,
      source: 'APPLICATION',
      data: {
        schemaVersion: 1,
        revision: 1,
        rejectionReason: null,
      },
    },
  });
  const expectedScope = await currentScope(fixture.teamId);

  const failure = await deletionRepository
    .deleteTeam(PROGRAM_ID, fixture.teamId, STAFF_ID, expectedScope, () =>
      Promise.reject(new Error('synthetic notification enqueue failure')),
    )
    .then(() => null)
    .catch((caught: unknown) => caught);

  expect(failure).not.toBeNull();
  await expect(
    prisma.team.findUnique({ where: { id: fixture.teamId } }),
  ).resolves.not.toBeNull();
  await expect(
    prisma.team.count({ where: { id: fixture.teamId } }),
  ).resolves.toBe(1);
  await expect(
    prisma.teamHistory.count({
      where: { teamId: fixture.teamId },
    }),
  ).resolves.toBe(1);
  await expect(teamDeletedNotifications(fixture.teamId)).resolves.toEqual([]);
});

it('같은 삭제를 재시도해도 수신자당 알림이 둘로 늘지 않는다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);
  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    expectedScope,
  );
  const first = await teamDeletedNotifications(fixture.teamId);
  expect(first).toHaveLength(2);

  await expect(
    service.deleteForStaff(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
    ),
  ).rejects.toBeDefined();

  await expect(teamDeletedNotifications(fixture.teamId)).resolves.toHaveLength(
    2,
  );
});

it('수신자는 팀 행을 잠근 뒤의 실제 멤버십과 일치한다', async () => {
  const fixture = await seedApprovedTeam();
  const staleScope = await currentScope(fixture.teamId);
  await prisma.teamMember.deleteMany({
    where: { teamId: fixture.teamId, userId: MEMBER_ID },
  });
  const currentScopeCounts = await currentScope(fixture.teamId);
  expect(staleScope.members).toBe(2);
  expect(currentScopeCounts.members).toBe(1);

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    currentScopeCounts,
  );

  const notifications = await teamDeletedNotifications(fixture.teamId);
  expect(notifications.map((row) => row.userId)).toEqual([LEADER_ID]);
});

it('팀 삭제 후에도 해당 팀과 같은 프로그램의 다른 팀 판정 이력은 보존된다', async () => {
  const target = await seedApprovedTeam();
  await prisma.teamMember.deleteMany({ where: { teamId: target.teamId } });
  const survivor = await seedApprovedTeam();
  for (const teamId of [target.teamId, survivor.teamId]) {
    await prisma.teamHistory.create({
      data: {
        id: `${teamId}:cascade-history`,
        teamId,
        actorId: STAFF_ID,
        occurredAt: new Date('2026-09-01T00:00:00.000Z'),
        programId: PROGRAM_ID,
        event: TeamHistoryEvent.APPROVED,
        source: 'APPLICATION',
        data: {
          schemaVersion: 1,
          revision: 1,
          rejectionReason: null,
        },
      },
    });
  }
  const expectedScope = await currentScope(target.teamId);

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    target.teamId,
    expectedScope,
  );

  await expect(
    prisma.teamHistory.count({
      where: { teamId: target.teamId, event: TeamHistoryEvent.APPROVED },
    }),
  ).resolves.toBe(1);
  await expect(
    prisma.teamHistory.count({
      where: { teamId: survivor.teamId },
    }),
  ).resolves.toBe(1);
  await expect(
    prisma.team.findUnique({ where: { id: survivor.teamId } }),
  ).resolves.not.toBeNull();
});
