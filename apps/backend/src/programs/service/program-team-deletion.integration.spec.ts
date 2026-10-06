import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  ApplicationReviewEventKind,
  ApplicationStatus,
  MilestoneDocumentSubmissionHistoryEvent,
  ProgramCategory,
  ProgramTrackType,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { TEAM_DELETED_AUDIT_ACTIONS } from '../../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { canonicalUserCreateFromLabel } from '../../users/canonical-user-fixture';
import { ProgramTeamDeletionRepository } from '../repository/program-team-deletion.repository';
import { ProgramTeamsRepository } from '../repository/program-teams.repository';
import { TeamsErrorCode } from '../teams-error-code.enum';
import { ProgramTeamsService } from './program-teams.service';

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

const STAFF_GITHUB_ID = 9_460_000_001n;
const LEADER_GITHUB_ID = 9_460_000_002n;
const MEMBER_GITHUB_ID = 9_460_000_003n;
const INVITEE_GITHUB_ID = 9_460_000_004n;

const GITHUB_ID_BY_USER: ReadonlyMap<string, bigint> = new Map([
  [STAFF_ID, STAFF_GITHUB_ID],
  [LEADER_ID, LEADER_GITHUB_ID],
  [MEMBER_ID, MEMBER_GITHUB_ID],
  [INVITEE_ID, INVITEE_GITHUB_ID],
]);

const RUN_PREFIX = `${TEST_PREFIX}run-${randomUUID()}:`;

const prisma = new PrismaService();
const deletionRepository = new ProgramTeamDeletionRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new ProgramTeamsService(
  new ProgramTeamsRepository(prisma),
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: `${TEST_PREFIX}join-secret` }),
  auditLog,
  deletionRepository,
);

let teamSequence = 0;

interface SeededTeam {
  readonly teamId: string;
  readonly applicationId: string;
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
  await prisma.notification.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { idempotencyKey: { startsWith: TEST_PREFIX } },
  });
  await prisma.submissionFile.deleteMany({
    where: { uploaderId: { startsWith: TEST_PREFIX } },
  });
  await prisma.milestoneDocumentReviewHistory.deleteMany({
    where: { reviewerId: { startsWith: TEST_PREFIX } },
  });
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { actorId: { startsWith: TEST_PREFIX } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { submittedById: { startsWith: TEST_PREFIX } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { applicationId: { startsWith: TEST_PREFIX } },
  });
  await prisma.contribution.deleteMany({
    where: { repositoryId: { startsWith: TEST_PREFIX } },
  });
  await prisma.githubRepository.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamInvitation.deleteMany({
    where: { inviteeId: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { applicantId: { startsWith: TEST_PREFIX } },
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
      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: 'Synthetic milestone',
      dueAt: new Date('2026-09-30T00:00:00.000Z'),
    },
  });
  await prisma.milestoneDocument.upsert({
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
  const applicationId = `${teamId}:application`;
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
      joinCodeDigest: `${teamId}:digest`,
      leaderId: LEADER_ID,
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
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId: LEADER_ID,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedById: STAFF_ID,
      processedAt: new Date('2026-08-10T00:00:00.000Z'),
    },
  });

  if (programId === PROGRAM_ID) {
    await prisma.milestoneDocumentSubmission.create({
      data: {
        id: submissionId,
        milestoneDocumentId: MILESTONE_DOCUMENT_ID,
        applicationId,
        submittedById: LEADER_ID,
        revision: 1,
        status: SubmissionStatus.SUBMITTED,
        histories: {
          create: {
            id: historyId,
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorId: LEADER_ID,
          },
        },
      },
    });
    await prisma.milestoneDocumentReviewHistory.create({
      data: {
        id: reviewHistoryId,
        milestoneDocumentSubmissionId: submissionId,
        submissionHistoryId: historyId,
        reviewerId: STAFF_ID,
        decision: ReviewDecision.APPROVED,
      },
    });
    await prisma.submissionFile.create({
      data: {
        id: `${teamId}:file`,
        uploaderId: LEADER_ID,
        applicationId,
        milestoneId: MILESTONE_ID,
        milestoneDocumentSubmissionId: submissionId,
        milestoneDocumentSubmissionHistoryId: historyId,
        lifecycle: SubmissionFileLifecycle.ATTACHED,
        pendingExpiresAt: null,
        expiresAt: new Date('2099-12-31T00:00:00.000Z'),
        storageKey: `${teamId}/synthetic.pdf`,
        originalFileName: 'synthetic.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
      },
    });
  }

  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      githubRepositoryId: BigInt(940_000_000 + teamSequence),
      nameWithOwner: `synthetic-org/team-${teamSequence}`,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: RepositoryVisibility.PUBLIC,
      programId,
      applicationId,
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
      applicationId,
      repositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    },
  });
  const outboxEvent = await prisma.outboxEvent.create({
    data: {
      type: 'REPOSITORY_PROVISION_REQUESTED',
      aggregateType: 'Application',
      aggregateId: applicationId,
      idempotencyKey: `${TEST_PREFIX}repository-provision:${applicationId}`,
      payload: { applicationId },
    },
    select: { id: true },
  });
  const decisionNotification = await prisma.notification.create({
    data: {
      userId: LEADER_ID,
      type: 'APPLICATION_DECISION',
      channel: 'IN_APP',
      status: 'UNREAD',
      idempotencyKey: `${TEST_PREFIX}application-decision:${applicationId}`,
      payload: {
        schemaVersion: 1,
        applicationId,
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
    applicationId,
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

it('승인된 팀도 확인한 범위와 맞으면 팀과 그 아래가 함께 사라진다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);

  expect(expectedScope).toMatchObject({
    applications: 1,
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
      applications: 1,
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
    prisma.application.count({ where: { id: fixture.applicationId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.milestoneDocumentSubmission.count({
      where: { id: fixture.submissionId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.milestoneDocumentSubmissionHistory.count({
      where: { id: fixture.historyId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.milestoneDocumentReviewHistory.count({
      where: { id: fixture.reviewHistoryId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.repositoryProvisionJob.count({
      where: { applicationId: fixture.applicationId },
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

it('GithubRepository 는 지우지 않고 연결만 끊으며 수집 이력은 그대로 남는다', async () => {
  const fixture = await seedApprovedTeam();

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  const repository = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: fixture.repositoryId },
    select: {
      programId: true,
      applicationId: true,
      teamId: true,
      publishedAt: true,
      visibility: true,
    },
  });
  expect(repository).toEqual({
    programId: null,
    applicationId: null,
    teamId: null,

    publishedAt: null,
    visibility: RepositoryVisibility.PUBLIC,
  });
  await expect(
    prisma.contribution.count({
      where: { repositoryId: fixture.repositoryId },
    }),
  ).resolves.toBe(1);
});

it('첨부 파일은 지우지 않고 DELETE_PENDING 으로 넘기며 FK 를 모두 끊는다', async () => {
  const fixture = await seedApprovedTeam();

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  const file = await prisma.submissionFile.findUniqueOrThrow({
    where: { id: fixture.fileId },
    select: {
      lifecycle: true,
      applicationId: true,
      milestoneId: true,
      milestoneDocumentSubmissionId: true,
      milestoneDocumentSubmissionHistoryId: true,
      deletedAt: true,
      nextDeleteAttemptAt: true,
    },
  });
  expect(file).toMatchObject({
    lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
    applicationId: null,
    milestoneId: null,
    milestoneDocumentSubmissionId: null,
    milestoneDocumentSubmissionHistoryId: null,
    deletedAt: null,
  });

  expect(file.nextDeleteAttemptAt).not.toBeNull();
});

it('감사에는 팀 이름과 함께 사라진 수치를 남긴다', async () => {
  const fixture = await seedApprovedTeam();

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    await currentScope(fixture.teamId),
  );

  const rows = await prisma.auditLog.findMany({
    where: {
      targetType: 'TEAM',
      targetId: fixture.teamId,
      action: TEAM_DELETED_AUDIT_ACTIONS.TEAM_DELETED,
    },
    select: { actorId: true, metadata: true },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.actorId).toBe(STAFF_ID);
  expect(rows[0]?.metadata).toMatchObject({
    schemaVersion: 1,
    deletedCounts: {
      applications: 1,
      members: 2,
      invitations: 1,
      submissions: 1,
      submissionEvents: 3,
      detachedRepositories: 1,
    },
  });

  const metadata = rows[0]?.metadata as { readonly teamName: string };
  expect(metadata.teamName).toContain('Team ');
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
    prisma.application.count({ where: { id: fixture.applicationId } }),
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
      applications: 0,
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
      applicationId: fixture.applicationId,
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
      prisma.application.count({ where: { id: fixture.applicationId } }),
    ).resolves.toBe(0);

    const retained = await prisma.repositoryIssuanceHistory.findUnique({
      where: { requestId },
      select: { applicationId: true, outcome: true },
    });
    expect(retained).toEqual({
      applicationId: fixture.applicationId,
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

it('문구를 비우면 삭제 사실만 담은 알림이 팀원 전원에게 같은 커밋으로 남는다', async () => {
  const fixture = await seedApprovedTeam();
  const expectedScope = await currentScope(fixture.teamId);

  await service.deleteForStaff(
    STAFF_GITHUB_ID,
    PROGRAM_ID,
    fixture.teamId,
    expectedScope,
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
  await prisma.applicationReviewHistory.create({
    data: {
      id: `${fixture.teamId}:review-history`,
      applicationId: fixture.applicationId,
      eventKind: ApplicationReviewEventKind.APPROVED,
      revision: 1,
      actorId: STAFF_ID,
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
  const expectedScope = await currentScope(fixture.teamId);
  const auditsBefore = await prisma.auditLog.count({
    where: { targetId: fixture.teamId },
  });

  const failure = await deletionRepository
    .deleteTeam(
      PROGRAM_ID,
      fixture.teamId,
      expectedScope,
      async (store, event) => {
        await auditLog.record(
          {
            actorGithubId: STAFF_GITHUB_ID,
            action: TEAM_DELETED_AUDIT_ACTIONS.TEAM_DELETED,
            targetType: 'TEAM',
            targetId: event.teamId,
            metadata: {
              schemaVersion: 1,
              programName: event.programName,
              teamName: event.teamName,
              deletedCounts: event.deletedCounts,
            },
          },
          store.auditLogWriter,
        );
      },
      () => Promise.reject(new Error('synthetic notification enqueue failure')),
    )
    .then(() => null)
    .catch((caught: unknown) => caught);

  expect(failure).not.toBeNull();
  await expect(
    prisma.team.findUnique({ where: { id: fixture.teamId } }),
  ).resolves.not.toBeNull();
  await expect(
    prisma.application.count({ where: { id: fixture.applicationId } }),
  ).resolves.toBe(1);
  await expect(
    prisma.applicationReviewHistory.count({
      where: { applicationId: fixture.applicationId },
    }),
  ).resolves.toBe(1);
  await expect(
    prisma.auditLog.count({ where: { targetId: fixture.teamId } }),
  ).resolves.toBe(auditsBefore);
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

it('팀 삭제는 그 팀의 판정 이력만 거두고 같은 프로그램의 다른 팀 이력은 남긴다', async () => {
  const target = await seedApprovedTeam();
  await prisma.teamMember.deleteMany({ where: { teamId: target.teamId } });
  const survivor = await seedApprovedTeam();
  for (const [teamId, applicationId] of [
    [target.teamId, target.applicationId],
    [survivor.teamId, survivor.applicationId],
  ] as const) {
    await prisma.applicationReviewHistory.create({
      data: {
        id: `${teamId}:cascade-history`,
        applicationId,
        eventKind: ApplicationReviewEventKind.APPROVED,
        revision: 1,
        actorId: STAFF_ID,
        occurredAt: new Date('2026-09-01T00:00:00.000Z'),
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
    prisma.applicationReviewHistory.count({
      where: { applicationId: target.applicationId },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.applicationReviewHistory.count({
      where: { applicationId: survivor.applicationId },
    }),
  ).resolves.toBe(1);
  await expect(
    prisma.team.findUnique({ where: { id: survivor.teamId } }),
  ).resolves.not.toBeNull();
});
