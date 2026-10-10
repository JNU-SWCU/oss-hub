import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  MilestoneDocumentSubmissionHistoryEvent,
  ProgramCategory,
  ProgramTrackType,
  SubmissionFileLifecycle,
  SubmissionStatus,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { TEAM_MEMBERSHIP_AUDIT_ACTIONS } from '../../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { TeamInvitationsRepository } from '../../team-invitations/repository/team-invitations.repository';
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
const repository = new ProgramTeamsRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new ProgramTeamsService(
  repository,
  loadRuntimeConfig({
    TEAM_JOIN_CODE_SECRET: `${TEST_PREFIX}join-code-secret`,
  }),
  auditLog,
  new ProgramTeamDeletionRepository(prisma),
);
const invitations = new TeamInvitationsRepository(prisma);

interface MemberSeed {
  readonly userId: string;

  readonly memberRowId: string;
  readonly createdAt: Date;
}

async function cleanupTeamScope(): Promise<void> {
  await prisma.submissionFile.deleteMany({
    where: { uploaderId: { startsWith: TEST_PREFIX } },
  });

  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: { application: { programId: PROGRAM_ID } } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { application: { programId: PROGRAM_ID } },
  });
  await prisma.teamInvitation.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
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
      joinCodeDigest: `${teamId}:digest`,
      leaderId,
    },
  });
  for (const member of members) {
    await prisma.teamMember.create({
      data: {
        id: member.memberRowId,
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
  const application = await prisma.application.create({
    data: {
      id: `${teamId}:application`,
      programId: PROGRAM_ID,
      applicantId,
      teamId,
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
  applicationId: string,
  submitterId: string,
): Promise<SubmittedDocument> {
  const submissionId = `${applicationId}:submission`;
  const historyId = `${applicationId}:history`;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: MILESTONE_DOCUMENT_ID,
      applicationId,
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
  const file = await prisma.submissionFile.create({
    data: {
      id: `${applicationId}:file`,
      uploaderId: submitterId,
      applicationId,
      milestoneId: MILESTONE_ID,
      milestoneDocumentSubmissionId: submissionId,
      milestoneDocumentSubmissionHistoryId: historyId,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      pendingExpiresAt: null,
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      storageKey: `${applicationId}/synthetic.pdf`,
      originalFileName: 'synthetic.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
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

async function membershipAuditRows(teamId: string) {
  return prisma.auditLog.findMany({
    where: {
      targetType: 'TEAM',
      targetId: teamId,
      action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
    },
    orderBy: { occurredAt: 'asc' },
    select: { actorId: true, metadata: true },
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

  it('promotes the lowest member row id when two members joined at the same instant', async () => {
    const teamId = `${RUN_PREFIX}team-tie`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_A_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID, MEMBER_B_ID].sort());
    await expectLeaderInsideMembership(teamId);
  });

  it('promotes the earliest joiner even when its member row id sorts last', async () => {
    const teamId = `${RUN_PREFIX}team-order`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0009`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    await expectLeaderInsideMembership(teamId);
  });

  it('lets a non-last member leave after the team already submitted an application', async () => {
    const teamId = `${RUN_PREFIX}team-applied-leave`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);

    await service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID);

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { teamId: true, applicantId: true, status: true },
      }),
    ).resolves.toEqual({
      teamId,
      applicantId: LEADER_ID,
      status: ApplicationStatus.SUBMITTED,
    });
  });

  it('hands leadership to the successor and never rewrites the recorded applicant', async () => {
    const teamId = `${RUN_PREFIX}team-successor`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);

    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_A_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID]);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { applicantId: true, teamId: true },
      }),
    ).resolves.toEqual({ applicantId: LEADER_ID, teamId });

    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(LEADER_ID);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'LEAVE',
      removedUserId: LEADER_ID,
      previousLeaderId: LEADER_ID,
      nextLeaderId: MEMBER_A_ID,
    });
  });

  it('preserves the application and its submission history when the leader removes a member', async () => {
    const teamId = `${RUN_PREFIX}team-remove`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, MEMBER_A_ID);

    await service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID);

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { teamId: true, applicantId: true },
      }),
    ).resolves.toEqual({ teamId, applicantId: LEADER_ID });

    await expect(
      prisma.milestoneDocumentSubmission.findUniqueOrThrow({
        where: { id: submitted.submissionId },
        select: { applicationId: true, submittedById: true, status: true },
      }),
    ).resolves.toEqual({
      applicationId,
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
      prisma.submissionFile.findUniqueOrThrow({
        where: { id: submitted.fileId },
        select: {
          applicationId: true,
          uploaderId: true,
          lifecycle: true,
          milestoneDocumentSubmissionId: true,
          milestoneDocumentSubmissionHistoryId: true,
          deletedAt: true,
        },
      }),
    ).resolves.toEqual({
      applicationId,
      uploaderId: MEMBER_A_ID,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      milestoneDocumentSubmissionId: submitted.submissionId,
      milestoneDocumentSubmissionHistoryId: submitted.historyId,
      deletedAt: null,
    });

    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'REMOVE',
      removedUserId: MEMBER_A_ID,
      previousLeaderId: LEADER_ID,
      nextLeaderId: LEADER_ID,
    });
    await expectLeaderInsideMembership(teamId);
  });

  it('blocks the last member of an applied team with 409 and keeps every row', async () => {
    const teamId = `${RUN_PREFIX}team-last`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, LEADER_ID);

    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: {
        code: TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION,
        status: 409,
      },
    });

    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(
      prisma.application.count({ where: { id: applicationId } }),
    ).resolves.toBe(1);
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
      prisma.submissionFile.count({ where: { id: submitted.fileId } }),
    ).resolves.toBe(1);
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('deletes the sole unapplied team together with its pending invitations', async () => {
    const teamId = `${RUN_PREFIX}team-sole`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
    ]);
    const invitationId = await seedPendingInvitation(teamId, LEADER_ID);

    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(0);
    await expect(prisma.teamMember.count({ where: { teamId } })).resolves.toBe(
      0,
    );
    await expect(
      prisma.teamInvitation.count({ where: { id: invitationId } }),
    ).resolves.toBe(0);

    await expect(
      prisma.user.count({ where: { id: INVITEE_ID } }),
    ).resolves.toBe(1);

    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'LEAVE',
      removedUserId: LEADER_ID,
      previousLeaderId: LEADER_ID,

      nextLeaderId: null,
    });
  });

  it('rolls back the leadership handover when the same-transaction audit write fails', async () => {
    const teamId = `${RUN_PREFIX}team-audit-rollback`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);

    await expect(
      repository.leave(PROGRAM_ID, LEADER_ID, async () => {
        await Promise.resolve();
        throw new Error('synthetic audit failure');
      }),
    ).rejects.toThrow('synthetic audit failure');

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('rolls back the member removal when the same-transaction audit write fails', async () => {
    const teamId = `${RUN_PREFIX}team-audit-rollback-remove`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);

    await expect(
      repository.removeMember(PROGRAM_ID, LEADER_ID, MEMBER_A_ID, async () => {
        await Promise.resolve();
        throw new Error('synthetic audit failure');
      }),
    ).rejects.toThrow('synthetic audit failure');

    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('serializes a concurrent leader leave and member leave without stranding leadership', async () => {
    const teamId = `${RUN_PREFIX}team-concurrent-leave`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    const settled = await Promise.allSettled([
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
      service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID),
    ]);

    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);

    expect(await rosterOf(teamId)).toEqual([MEMBER_B_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    await expectLeaderInsideMembership(teamId);
    expect(await membershipAuditRows(teamId)).toHaveLength(2);
  });

  it('serializes an invitation acceptance against a concurrent removal on an applied team', async () => {
    const teamId = `${RUN_PREFIX}team-concurrent-accept`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, LEADER_ID);
    const invitationId = await seedPendingInvitation(teamId, LEADER_ID);

    const settled = await Promise.allSettled([
      invitations.withAcceptTransaction(invitationId, INVITEE_ID),
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
      prisma.teamInvitation.findUniqueOrThrow({
        where: { id: invitationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: TeamInvitationStatus.ACCEPTED });

    await expect(
      prisma.application.count({ where: { id: applicationId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmission.count({
        where: { id: submitted.submissionId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.submissionFile.count({ where: { id: submitted.fileId } }),
    ).resolves.toBe(1);
  });

  describe('staff team composition', () => {
    it('교직원이 팀 밖에서 팀원을 제외한다 — 팀장 자리는 그대로다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          memberRowId: `${teamId}:2`,
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
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_SECOND,
        },
        {
          userId: MEMBER_A_ID,
          memberRowId: `${teamId}:2`,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_B_ID,
          memberRowId: `${teamId}:3`,
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

    it('신청이 매달린 팀의 마지막 팀원은 교직원도 뺄 수 없다', async () => {
      const teamId = `${RUN_PREFIX}staff-remove-last`;
      await seedTeam(teamId, LEADER_ID, [
        {
          userId: LEADER_ID,
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_FIRST,
        },
      ]);
      await seedApplication(teamId, LEADER_ID);

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
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          memberRowId: `${teamId}:2`,
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
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          memberRowId: `${teamId}:2`,
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
          memberRowId: `${teamId}:1`,
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
          memberRowId: `${teamId}:1`,
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
          memberRowId: `${teamId}:1`,
          createdAt: JOINED_FIRST,
        },
        {
          userId: MEMBER_A_ID,
          memberRowId: `${teamId}:2`,
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
