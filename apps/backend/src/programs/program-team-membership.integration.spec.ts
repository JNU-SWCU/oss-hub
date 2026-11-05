import { TeamHistoryRepository } from './team-history.repository';
import { StudentRepositoryUrlService } from './team-application.service';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { TeamDeletionScopeRepository } from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  MilestoneDocumentSubmissionHistoryEvent,
  ProgramCategory,
  ProgramTrackType,
  FileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { ProgramTeamDeletionRepository } from './team.repository';
import { TeamRepository } from './team.repository';
import { TeamsErrorCode } from './teams-error-code.error';
import { TeamMembershipService } from './team-membership.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './milestone-completion.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'synthetic-team-membership:';
const PROGRAM_ID = `${TEST_PREFIX}program`;

const RUN_PREFIX = `${TEST_PREFIX}run-${randomUUID()}:`;

const MILESTONE_ID = `${TEST_PREFIX}milestone`;
const MILESTONE_DOCUMENT_ID = `${TEST_PREFIX}milestone-document`;

const LEADER_ID = `${TEST_PREFIX}leader`;
const MEMBER_A_ID = `${TEST_PREFIX}member-a`;
const MEMBER_B_ID = `${TEST_PREFIX}member-b`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;

const STAFF_ID = `${TEST_PREFIX}staff`;

const GITHUB_ID_BY_USER: ReadonlyMap<string, bigint> = new Map([
  [LEADER_ID, 9_450_000_001n],
  [MEMBER_A_ID, 9_450_000_002n],
  [MEMBER_B_ID, 9_450_000_003n],
  [INVITEE_ID, 9_450_000_004n],
  [STAFF_ID, 9_450_000_005n],
]);

function githubIdOf(userId: string): bigint {
  const githubId = GITHUB_ID_BY_USER.get(userId);
  if (githubId === undefined) {
    throw new Error(`unknown fixture user ${userId}`);
  }
  return githubId;
}

const JOINED_FIRST = new Date('2026-08-02T00:00:00.000Z');
const JOINED_SECOND = new Date('2026-08-03T00:00:00.000Z');

const prisma = new PrismaService();
const repository = new TeamRepository(
  prisma,
  new ProgramTeamRepositoryEvidenceRepository(prisma),
  new PlatformRepository(),
  new TeamHistoryRepository(),
);

const service = new TeamMembershipService(
  repository,
  new ProgramTeamDeletionRepository(
    new TeamHistoryRepository(),
    prisma,
    new TeamDeletionScopeRepository(),
    new PrismaSerializationRetryRepository(),
  ),
  new AuditLogMetadataService(),
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
const invitations = new TeamInvitationsRepository(
  new TeamHistoryRepository(),
  prisma,
  new PlatformRepository(),
);

interface MemberSeed {
  readonly userId: string;

  readonly createdAt: Date;
}

async function cleanupTeamScope(): Promise<void> {
  await prisma.teamHistory.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.file.deleteMany({
    where: { kind: 'SUBMISSION', uploaderId: { startsWith: TEST_PREFIX } },
  });

  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: { team: { programId: PROGRAM_ID } } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { team: { programId: PROGRAM_ID } },
  });
  await prisma.teamInvitation.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { team: { programId: PROGRAM_ID } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateType: 'Team', aggregateId: { startsWith: RUN_PREFIX } },
  });
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
}

async function seedDurableFixturesOnce(): Promise<void> {
  for (const [userId, githubId] of GITHUB_ID_BY_USER) {
    const existing = await prisma.user.count({ where: { id: userId } });
    if (existing > 0) continue;
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
  await prisma.program.upsert({
    where: { id: PROGRAM_ID },
    update: {},
    create: {
      startAt: new Date('2026-08-01T00:00:00.000Z'),
      endAt: new Date(
        new Date('2026-08-31T00:00:00.000Z').getTime() + 365 * 86400000,
      ),
      id: PROGRAM_ID,
      name: 'Team membership program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic team membership fixture',
      teamMinSize: 1,
      teamMaxSize: 4,
    },
  });

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

async function seedTeam(
  teamId: string,
  leaderId: string,
  members: readonly MemberSeed[],
): Promise<void> {
  await prisma.team.create({
    data: {
      id: teamId,
      programId: PROGRAM_ID,
      name: `Team ${teamId}`,
      leaderId,
      applicantId: leaderId,
      answers: { title: `Team ${teamId}` },
      applicationTemplateVersion: 1,
    },
  });
  for (const member of members) {
    await prisma.teamMember.create({
      data: {
        teamId,
        programId: PROGRAM_ID,
        userId: member.userId,
        createdAt: member.createdAt,
      },
    });
  }
}

async function seedApplication(
  teamId: string,
  applicantId: string,
): Promise<string> {
  const application = await prisma.team.update({
    where: { id: teamId },
    data: {
      programId: PROGRAM_ID,
      applicantId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.SUBMITTED,
    },
    select: { id: true },
  });
  return application.id;
}

interface SubmittedDocument {
  readonly submissionId: string;
  readonly historyId: string;
  readonly fileId: string;
}

async function seedSubmittedDocument(
  teamId: string,
  submitterId: string,
): Promise<SubmittedDocument> {
  const submissionId = `${teamId}:submission`;
  const historyId = `${teamId}:history`;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: MILESTONE_DOCUMENT_ID,
      teamId,
      submittedById: submitterId,
      revision: 1,
      status: SubmissionStatus.SUBMITTED,
      histories: {
        create: {
          id: historyId,
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          actorId: submitterId,
        },
      },
    },
  });
  const file = await prisma.file.create({
    data: {
      kind: 'SUBMISSION',
      id: `${teamId}:file`,
      uploaderId: submitterId,
      teamId,
      submissionId: submissionId,
      submissionHistoryId: historyId,
      lifecycle: FileLifecycle.ATTACHED,
      pendingExpiresAt: null,
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      storageKey: `${teamId}/synthetic.pdf`,
      originalFileName: 'synthetic.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    },
    select: { id: true },
  });
  return { submissionId, historyId, fileId: file.id };
}

async function seedPendingInvitation(
  teamId: string,
  invitedById: string,
): Promise<string> {
  const invitation = await prisma.teamInvitation.create({
    data: {
      id: `${teamId}:invitation`,
      teamId,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById,
    },
    select: { id: true },
  });
  return invitation.id;
}

async function rosterOf(teamId: string): Promise<readonly string[]> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    select: { userId: true },
  });
  return members.map((member) => member.userId).sort();
}

async function membershipHistoryRows(teamId: string) {
  return prisma.teamHistory.findMany({
    where: {
      teamId,
      event: { in: ['MEMBER_LEFT', 'MEMBER_REMOVED', 'LEADER_TRANSFERRED'] },
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { actorId: true, event: true, data: true },
  });
}

async function expectLeaderInsideMembership(teamId: string): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { leaderId: true },
  });
  if (team === null) return;
  const roster = await rosterOf(teamId);
  expect(roster.length).toBeGreaterThan(0);
  expect(roster).toContain(team.leaderId);
}

describe('program team membership transactions integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanupTeamScope();
    await seedDurableFixturesOnce();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanupTeamScope);

  afterEach(cleanupTeamScope);

  afterAll(async () => {
    await cleanupTeamScope();
    await prisma.$disconnect();
  });

  it('requires explicit transfer when members share a join timestamp', async () => {
    const teamId = RUN_PREFIX + 'team-tied-explicit';
    await seedTeam(teamId, LEADER_ID, [
      { userId: LEADER_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_B_ID, createdAt: JOINED_SECOND },
      { userId: MEMBER_A_ID, createdAt: JOINED_SECOND },
    ]);
    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.LEADER_TRANSFER_REQUIRED },
    });
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual(
      [LEADER_ID, MEMBER_A_ID, MEMBER_B_ID].sort(),
    );
    expect(await membershipHistoryRows(teamId)).toEqual([]);
    await service.transferLeader(
      githubIdOf(LEADER_ID),
      PROGRAM_ID,
      MEMBER_B_ID,
    );
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID, MEMBER_B_ID].sort());
    const history = await membershipHistoryRows(teamId);
    expect(history).toHaveLength(2);
    expect(
      history.find((row) => row.event === 'LEADER_TRANSFERRED'),
    ).toMatchObject({
      actorId: LEADER_ID,
      data: { previousLeaderId: LEADER_ID, nextLeaderId: MEMBER_B_ID },
    });
    expect(history.find((row) => row.event === 'MEMBER_LEFT')).toMatchObject({
      actorId: LEADER_ID,
    });
  });

  it('honors explicit transfer instead of choosing the earliest member', async () => {
    const teamId = RUN_PREFIX + 'team-earliest-explicit';
    await seedTeam(teamId, LEADER_ID, [
      { userId: LEADER_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_A_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_B_ID, createdAt: JOINED_SECOND },
    ]);
    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.LEADER_TRANSFER_REQUIRED },
    });
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual(
      [LEADER_ID, MEMBER_A_ID, MEMBER_B_ID].sort(),
    );
    expect(await membershipHistoryRows(teamId)).toEqual([]);
    await service.transferLeader(
      githubIdOf(LEADER_ID),
      PROGRAM_ID,
      MEMBER_B_ID,
    );
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID, MEMBER_B_ID].sort());
    const history = await membershipHistoryRows(teamId);
    expect(history).toHaveLength(2);
    expect(
      history.find((row) => row.event === 'LEADER_TRANSFERRED'),
    ).toMatchObject({
      actorId: LEADER_ID,
      data: { previousLeaderId: LEADER_ID, nextLeaderId: MEMBER_B_ID },
    });
    expect(history.find((row) => row.event === 'MEMBER_LEFT')).toMatchObject({
      actorId: LEADER_ID,
    });
  });

  it('lets a non-last member leave after the team already submitted an application', async () => {
    const teamId = `${RUN_PREFIX}team-applied-leave`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        createdAt: JOINED_SECOND,
      },
    ]);

    await service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID);

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { id: true, applicantId: true, status: true },
      }),
    ).resolves.toEqual({
      id: teamId,
      applicantId: LEADER_ID,
      status: ApplicationStatus.SUBMITTED,
    });
  });

  it('requires transfer before leader leave and preserves the recorded applicant', async () => {
    const teamId = `${RUN_PREFIX}team-successor`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        createdAt: JOINED_SECOND,
      },
    ]);

    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.LEADER_TRANSFER_REQUIRED },
    });
    await service.transferLeader(
      githubIdOf(LEADER_ID),
      PROGRAM_ID,
      MEMBER_A_ID,
    );
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_A_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { applicantId: true, id: true },
      }),
    ).resolves.toEqual({ applicantId: LEADER_ID, id: teamId });

    const history = await membershipHistoryRows(teamId);
    expect(history).toHaveLength(2);
    expect(
      history.find((row) => row.event === 'LEADER_TRANSFERRED'),
    ).toMatchObject({
      actorId: LEADER_ID,
      data: { previousLeaderId: LEADER_ID, nextLeaderId: MEMBER_A_ID },
    });
    expect(history.find((row) => row.event === 'MEMBER_LEFT')).toMatchObject({
      actorId: LEADER_ID,
      data: {
        removedUserId: LEADER_ID,
        previousLeaderId: MEMBER_A_ID,
        nextLeaderId: MEMBER_A_ID,
      },
    });
  });

  it('preserves the application and its submission history when the leader removes a member', async () => {
    const teamId = `${RUN_PREFIX}team-remove`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        createdAt: JOINED_SECOND,
      },
    ]);
    const submitted = await seedSubmittedDocument(teamId, MEMBER_A_ID);

    await service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID);

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { id: true, applicantId: true },
      }),
    ).resolves.toEqual({ id: teamId, applicantId: LEADER_ID });

    await expect(
      prisma.milestoneDocumentSubmission.findUniqueOrThrow({
        where: { id: submitted.submissionId },
        select: { teamId: true, submittedById: true, status: true },
      }),
    ).resolves.toEqual({
      teamId,
      submittedById: MEMBER_A_ID,
      status: SubmissionStatus.SUBMITTED,
    });
    await expect(
      prisma.milestoneDocumentSubmissionHistory.findUniqueOrThrow({
        where: { id: submitted.historyId },
        select: {
          milestoneDocumentSubmissionId: true,
          actorId: true,
          event: true,
        },
      }),
    ).resolves.toEqual({
      milestoneDocumentSubmissionId: submitted.submissionId,
      actorId: MEMBER_A_ID,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
    });
    await expect(
      prisma.file.findUniqueOrThrow({
        where: { kind: 'SUBMISSION', id: submitted.fileId },
        select: {
          teamId: true,
          uploaderId: true,
          lifecycle: true,
          submissionId: true,
          submissionHistoryId: true,
          deletedAt: true,
        },
      }),
    ).resolves.toEqual({
      teamId,
      uploaderId: MEMBER_A_ID,
      lifecycle: FileLifecycle.ATTACHED,
      submissionId: submitted.submissionId,
      submissionHistoryId: submitted.historyId,
      deletedAt: null,
    });

    const audits = await membershipHistoryRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data).toMatchObject({
      removedUserId: MEMBER_A_ID,
      previousLeaderId: LEADER_ID,
      nextLeaderId: LEADER_ID,
    });
    await expectLeaderInsideMembership(teamId);
  });

  it('blocks the final preapproval member with activity and keeps every row', async () => {
    const teamId = `${RUN_PREFIX}team-last`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        createdAt: JOINED_FIRST,
      },
    ]);
    const submitted = await seedSubmittedDocument(teamId, LEADER_ID);

    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: {
        code: TeamsErrorCode.TEAM_HAS_ACTIVITY,
        status: 409,
      },
    });

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmission.count({
        where: { id: submitted.submissionId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmissionHistory.count({
        where: { id: submitted.historyId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.file.count({
        where: { kind: 'SUBMISSION', id: submitted.fileId },
      }),
    ).resolves.toBe(1);
    expect(await membershipHistoryRows(teamId)).toHaveLength(0);
  });

  it.each(['leave', 'staff removal'])(
    '%s deletes the sole unapplied team and preserves every invitation fact',
    async (operation) => {
      const teamId = `${RUN_PREFIX}team-sole:${operation}`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
      ]);
      const invitationId = await seedPendingInvitation(teamId, LEADER_ID);
      const pending = await prisma.teamInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      const legacy = await Promise.all(
        ['ACCEPTED', 'DECLINED', 'EXPIRED'].map((status) =>
          prisma.teamHistory.create({
            data: {
              id: `${teamId}:${status}`,
              teamId,
              programId: PROGRAM_ID,
              actorId: null,
              event: 'INVITATION_ARCHIVED',
              source: 'MIGRATION',
              sourceTable: 'TeamInvitation',
              sourceId: `${teamId}:${status}`,
              occurredAt: JOINED_SECOND,
              data: {
                schemaVersion: 1,
                invitation: {
                  id: `${teamId}:${status}`,
                  inviteeId: INVITEE_ID,
                  invitedById: LEADER_ID,
                  status,
                  createdAt: JOINED_FIRST.toISOString(),
                  respondedAt:
                    status === 'EXPIRED' ? null : JOINED_SECOND.toISOString(),
                  updatedAt: JOINED_SECOND.toISOString(),
                },
              },
            },
          }),
        ),
      );

      if (operation === 'leave') {
        await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);
      } else {
        await service.removeMemberForStaff(
          githubIdOf(STAFF_ID),
          PROGRAM_ID,
          teamId,
          LEADER_ID,
        );
      }

      await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(
        0,
      );
      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.teamInvitation.count({ where: { teamId } }),
      ).resolves.toBe(0);
      const actorId = operation === 'leave' ? LEADER_ID : STAFF_ID;
      const histories = await prisma.teamHistory.findMany({
        where: { teamId },
      });
      expect(histories).toHaveLength(operation === 'leave' ? 5 : 6);
      expect(
        histories.find((history) => history.event === 'DELETED'),
      ).toMatchObject({
        actorId,
        data: {
          reason: operation === 'leave' ? 'LAST_MEMBER_LEFT' : 'STAFF_DELETED',
          deletedCounts: { teams: 1, members: 1, invitations: 1 },
          members: [{ userId: LEADER_ID }],
        },
      });
      for (const archived of legacy) {
        expect(histories.find((history) => history.id === archived.id)).toEqual(
          archived,
        );
      }
      for (const invitation of [pending]) {
        expect(
          histories.filter((history) => history.sourceId === invitation.id),
        ).toEqual([
          expect.objectContaining({
            teamId,
            programId: PROGRAM_ID,
            actorId,
            event: 'INVITATION_CANCELLED',
            source: 'APPLICATION',
            sourceTable: 'TeamInvitation',
            data: {
              schemaVersion: 1,
              reason: 'TEAM_DELETED',
              invitation: {
                id: invitation.id,
                inviteeId: INVITEE_ID,
                invitedById: LEADER_ID,
                createdAt: invitation.createdAt.toISOString(),
              },
            },
          }),
        ]);
      }

      await expect(
        prisma.user.count({ where: { id: INVITEE_ID } }),
      ).resolves.toBe(1);

      const audits = await membershipHistoryRows(teamId);
      expect(audits).toHaveLength(operation === 'leave' ? 0 : 1);
      if (operation === 'staff removal')
        expect(audits[0]).toMatchObject({
          actorId: STAFF_ID,
          event: 'MEMBER_REMOVED',
          data: {
            removedUserId: LEADER_ID,
            previousLeaderId: LEADER_ID,
            nextLeaderId: null,
          },
        });
    },
  );

  it.each([
    ['leave', 'recordInvitationClosed'],
    ['leave', 'recordTeamInvitationsDeleted'],
    ['staff removal', 'recordInvitationClosed'],
    ['staff removal', 'recordTeamInvitationsDeleted'],
  ] as const)(
    '%s rolls back the sole team, member and invitation when %s fails',
    async (operation, method) => {
      const teamId = `${RUN_PREFIX}history-rollback:${operation}:${method}`;
      await seedTeam(teamId, LEADER_ID, [
        { userId: LEADER_ID, createdAt: JOINED_FIRST },
      ]);
      const invitationId = await seedPendingInvitation(teamId, LEADER_ID);
      const invitation = await prisma.teamInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      const original = TeamHistoryRepository.prototype[method];
      const failure = jest
        .spyOn(TeamHistoryRepository.prototype, method)
        .mockImplementationOnce(async (...args) => {
          await Reflect.apply(original, new TeamHistoryRepository(), args);
          throw new Error('synthetic invitation history failure');
        });
      try {
        await expect(
          operation === 'leave'
            ? service.leave(githubIdOf(LEADER_ID), PROGRAM_ID)
            : service.removeMemberForStaff(
                githubIdOf(STAFF_ID),
                PROGRAM_ID,
                teamId,
                LEADER_ID,
              ),
        ).rejects.toThrow('synthetic invitation history failure');
      } finally {
        failure.mockRestore();
      }
      await expect(
        prisma.team.findUnique({ where: { id: teamId } }),
      ).resolves.toMatchObject({ leaderId: LEADER_ID });
      expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
      await expect(
        prisma.teamInvitation.findUnique({ where: { id: invitationId } }),
      ).resolves.toEqual(invitation);
      await expect(
        prisma.teamHistory.count({ where: { teamId } }),
      ).resolves.toBe(0);
      expect(await membershipHistoryRows(teamId)).toHaveLength(0);
    },
  );

  it('rolls back transfer when the actual TeamHistory write fails', async () => {
    const teamId = RUN_PREFIX + 'team-history-rollback-transfer';
    await seedTeam(teamId, LEADER_ID, [
      { userId: LEADER_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_A_ID, createdAt: JOINED_SECOND },
    ]);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "TeamHistory" ADD CONSTRAINT "synthetic_membership_history_failure" CHECK (event <> 'LEADER_TRANSFERRED') NOT VALID`,
    );
    try {
      await expect(
        service.transferLeader(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID),
      ).rejects.toThrow('synthetic_membership_history_failure');
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "TeamHistory" DROP CONSTRAINT "synthetic_membership_history_failure"',
      );
    }
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipHistoryRows(teamId)).toEqual([]);
  });

  it('rolls back remove when the actual TeamHistory write fails', async () => {
    const teamId = RUN_PREFIX + 'team-history-rollback-remove';
    await seedTeam(teamId, LEADER_ID, [
      { userId: LEADER_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_A_ID, createdAt: JOINED_SECOND },
    ]);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "TeamHistory" ADD CONSTRAINT "synthetic_membership_history_failure" CHECK (event <> 'MEMBER_REMOVED') NOT VALID`,
    );
    try {
      await expect(
        service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID),
      ).rejects.toThrow('synthetic_membership_history_failure');
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "TeamHistory" DROP CONSTRAINT "synthetic_membership_history_failure"',
      );
    }
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipHistoryRows(teamId)).toEqual([]);
  });

  it('serializes concurrent leaves without auto succession or losing the current leader', async () => {
    const teamId = RUN_PREFIX + 'team-concurrent-leaves';
    await seedTeam(teamId, LEADER_ID, [
      { userId: LEADER_ID, createdAt: JOINED_FIRST },
      { userId: MEMBER_A_ID, createdAt: JOINED_SECOND },
    ]);
    const submitted = await seedSubmittedDocument(teamId, LEADER_ID);
    const outcomes = await Promise.allSettled([
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
      service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID),
    ]);
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[1]?.status).toBe('fulfilled');
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.milestoneDocumentSubmissionHistory.count({
        where: { id: submitted.historyId },
      }),
    ).resolves.toBe(1);
    const history = await membershipHistoryRows(teamId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: MEMBER_A_ID,
      event: 'MEMBER_LEFT',
      data: {
        removedUserId: MEMBER_A_ID,
        previousLeaderId: LEADER_ID,
        nextLeaderId: LEADER_ID,
      },
    });
    await expectLeaderInsideMembership(teamId);
  });

  it('serializes an invitation acceptance against a concurrent removal on an applied team', async () => {
    const teamId = `${RUN_PREFIX}team-concurrent-accept`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        createdAt: JOINED_SECOND,
      },
    ]);
    const submitted = await seedSubmittedDocument(teamId, LEADER_ID);
    const invitationId = await seedPendingInvitation(teamId, LEADER_ID);
    const respondedAt = new Date('2026-09-01T00:00:00.000Z');

    const settled = await Promise.allSettled([
      invitations.withAcceptTransaction(invitationId, INVITEE_ID, respondedAt),
      service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID),
    ]);

    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    const acceptance = settled[0];
    if (acceptance.status !== 'fulfilled') {
      throw new Error('초대 수락이 거부되었다 — 직렬화가 아니라 실패다.');
    }
    expect(acceptance.value).toEqual({
      kind: 'ok',
      teamId,
      programId: PROGRAM_ID,
    });
    expect(await rosterOf(teamId)).toEqual([INVITEE_ID, LEADER_ID].sort());

    await expectLeaderInsideMembership(teamId);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    await expect(
      prisma.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { id: true },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.teamHistory.findMany({
        where: { sourceId: invitationId },
        select: { event: true, actorId: true },
      }),
    ).resolves.toEqual([{ event: 'INVITATION_ACCEPTED', actorId: INVITEE_ID }]);

    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmission.count({
        where: { id: submitted.submissionId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.file.count({
        where: { kind: 'SUBMISSION', id: submitted.fileId },
      }),
    ).resolves.toBe(1);
  });

  describe('staff team composition', () => {
    it('교직원이 팀 밖에서 팀원을 제외한다 — 팀장 자리는 그대로다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          createdAt: JOINED_SECOND,
        },
      ]);

      await service.removeMemberForStaff(
        githubIdOf(STAFF_ID),
        PROGRAM_ID,
        teamId,
        MEMBER_A_ID,
      );

      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: teamId },
          select: { leaderId: true },
        }),
      ).resolves.toEqual({ leaderId: LEADER_ID });
    });

    it('교직원이 팀장을 제외하면 가장 먼저 합류한 남은 팀원이 팀장이 된다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove-leader`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_SECOND,
        },
        {
          userId: MEMBER_A_ID,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_B_ID,
          createdAt: JOINED_SECOND,
        },
      ]);

      await service.removeMemberForStaff(
        githubIdOf(STAFF_ID),
        PROGRAM_ID,
        teamId,
        LEADER_ID,
      );

      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: teamId },
          select: { leaderId: true },
        }),
      ).resolves.toEqual({ leaderId: MEMBER_A_ID });

      await expect(
        prisma.teamMember.count({ where: { teamId, userId: MEMBER_A_ID } }),
      ).resolves.toBe(1);
    });

    it('교직원이 마지막 팀원을 제외하면 프로비저닝 작업과 outbox 행도 함께 지우고 팀을 삭제한다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove-last-jobs`;
      await seedTeam(teamId, LEADER_ID, [
        { userId: LEADER_ID, createdAt: JOINED_FIRST },
      ]);
      await prisma.repositoryProvisionJob.create({ data: { teamId } });
      await prisma.outboxEvent.create({
        data: {
          type: 'team.provision',
          aggregateType: 'Team',
          aggregateId: teamId,
          idempotencyKey: `${teamId}:provision`,
          payload: {},
        },
      });

      await service.removeMemberForStaff(
        githubIdOf(STAFF_ID),
        PROGRAM_ID,
        teamId,
        LEADER_ID,
      );

      await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(
        0,
      );
      await expect(
        prisma.repositoryProvisionJob.count({ where: { teamId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.outboxEvent.count({ where: { aggregateId: teamId } }),
      ).resolves.toBe(0);
    });

    it('승인된 팀의 마지막 팀원은 교직원도 뺄 수 없다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove-last`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
      ]);
      await seedApplication(teamId, LEADER_ID);
      await prisma.team.update({
        where: { id: teamId },
        data: {
          status: ApplicationStatus.APPROVED,
          processedById: STAFF_ID,
          processedAt: new Date('2026-09-01T00:00:00Z'),
        },
      });

      await expect(
        service.removeMemberForStaff(
          githubIdOf(STAFF_ID),
          PROGRAM_ID,
          teamId,
          LEADER_ID,
        ),
      ).rejects.toThrow();

      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(1);
    });

    it('학생은 교직원 경로로 남의 팀원을 뺄 수 없다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove-denied`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          createdAt: JOINED_SECOND,
        },
      ]);

      await expect(
        service.removeMemberForStaff(
          githubIdOf(MEMBER_B_ID),
          PROGRAM_ID,
          teamId,
          MEMBER_A_ID,
        ),
      ).rejects.toThrow();

      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(2);
    });

    it('교직원이 팀장을 바꾼다 — 구성원은 그대로다', async () => {
      const teamId = `${RUN_PREFIX}staff-transfer`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          createdAt: JOINED_SECOND,
        },
      ]);

      await service.transferLeaderForStaff(
        githubIdOf(STAFF_ID),
        PROGRAM_ID,
        teamId,
        MEMBER_A_ID,
      );

      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: teamId },
          select: { leaderId: true },
        }),
      ).resolves.toEqual({ leaderId: MEMBER_A_ID });
      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(2);
    });

    it('그 팀 구성원이 아닌 사람은 팀장이 될 수 없다', async () => {
      const teamId = `${RUN_PREFIX}staff-transfer-outsider`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
      ]);

      await expect(
        service.transferLeaderForStaff(
          githubIdOf(STAFF_ID),
          PROGRAM_ID,
          teamId,
          MEMBER_B_ID,
        ),
      ).rejects.toThrow();

      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: teamId },
          select: { leaderId: true },
        }),
      ).resolves.toEqual({ leaderId: LEADER_ID });
    });

    it('이미 팀장인 사람을 다시 지정해도 성공이고 아무것도 바뀌지 않는다', async () => {
      const teamId = `${RUN_PREFIX}staff-transfer-noop`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
      ]);

      await expect(
        service.transferLeaderForStaff(
          githubIdOf(STAFF_ID),
          PROGRAM_ID,
          teamId,
          LEADER_ID,
        ),
      ).resolves.toBeUndefined();

      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: teamId },
          select: { leaderId: true },
        }),
      ).resolves.toEqual({ leaderId: LEADER_ID });
    });

    it('프로그램과 팀이 어긋나면 존재를 알리지 않는다', async () => {
      const teamId = `${RUN_PREFIX}staff-wrong-program`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          createdAt: JOINED_SECOND,
        },
      ]);

      await expect(
        service.removeMemberForStaff(
          githubIdOf(STAFF_ID),
          `${PROGRAM_ID}:other`,
          teamId,
          MEMBER_A_ID,
        ),
      ).rejects.toThrow();

      await expect(
        prisma.teamMember.count({ where: { teamId } }),
      ).resolves.toBe(2);
    });
  });
});
