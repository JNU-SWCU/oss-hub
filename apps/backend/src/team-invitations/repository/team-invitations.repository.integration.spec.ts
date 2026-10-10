import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  ProgramTrackType,
  RepositoryConnectionMode,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import {
  REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
  parseRepositoryAccessSyncEvent,
} from '../../github/domain/repository-provision-event';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalUserCreateFromLabel } from '../../users/canonical-user-fixture';
import { TeamInvitationsRepository } from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'team-invitation-atomicity:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TARGET_TEAM_ID = `${TEST_PREFIX}target-team`;
const OTHER_TEAM_ID = `${TEST_PREFIX}other-team`;
const INVITATION_ID = `${TEST_PREFIX}invitation`;
const APPLICATION_ID = `${TEST_PREFIX}application`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const FILLER_ID = `${TEST_PREFIX}filler`;
const OUTSIDER_ID = `${TEST_PREFIX}outsider`;
const RESPONDED_AT = new Date('2026-08-10T00:00:00.000Z');
const prisma = new PrismaService();
const repository = new TeamInvitationsRepository(prisma);

async function cleanup(): Promise<void> {
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamInvitation.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.teamMember.deleteMany({
    where: { programId: PROGRAM_ID },
  });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function seedPendingInvitation(): Promise<void> {
  for (const [id, githubId, nickname] of [
    [LEADER_ID, 9_100_000_001n, 'atomic-leader'],
    [INVITEE_ID, 9_100_000_002n, 'atomic-invitee'],
    [FILLER_ID, 9_100_000_003n, 'atomic-filler'],
    [OUTSIDER_ID, 9_100_000_004n, 'atomic-outsider'],
  ] as const) {
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('STUDENT', {
        id,
        githubId,
        nickname,
        name: 'Synthetic user',
      }),
    });
  }
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Invitation atomicity program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic invitation transaction fixture',
      teamMinSize: 1,
      teamMaxSize: 2,
    },
  });
  await prisma.team.create({
    data: {
      id: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      name: 'Target team',
      joinCodeDigest: `${TEST_PREFIX}target-digest`,
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      userId: LEADER_ID,
    },
  });
  await prisma.teamInvitation.create({
    data: {
      id: INVITATION_ID,
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
    },
  });
}

async function seedApplication(overrides?: {
  readonly status?: ApplicationStatus;
  readonly repositoryConnectionMode?: RepositoryConnectionMode;
  readonly repositoryUrl?: string;
}): Promise<void> {
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      applicantId: LEADER_ID,
      teamId: TARGET_TEAM_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: overrides?.status ?? ApplicationStatus.SUBMITTED,
      repositoryConnectionMode:
        overrides?.repositoryConnectionMode ?? RepositoryConnectionMode.NEW,
      repositoryUrl: overrides?.repositoryUrl ?? null,
    },
  });
}

async function enableRepositoryProvisioning(): Promise<void> {
  await prisma.program.update({
    where: { id: PROGRAM_ID },
    data: { repositoryProvisioningEnabled: true },
  });
}

async function storedAccessSyncEvents() {
  return prisma.outboxEvent.findMany({
    where: {
      type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
      aggregateId: { startsWith: TEST_PREFIX },
    },
    orderBy: { idempotencyKey: 'asc' },
  });
}

async function storedInvitationAndTargetMembership() {
  return Promise.all([
    prisma.teamInvitation.findUniqueOrThrow({ where: { id: INVITATION_ID } }),
    prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId: TARGET_TEAM_ID, userId: INVITEE_ID },
      },
    }),
  ]);
}

describe('TeamInvitationsRepository acceptance atomicity integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await seedPendingInvitation();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('projects only the allowlisted invitee fields on sent invitations', async () => {
    const [sent] = await repository.findByTeamId(TARGET_TEAM_ID);

    expect(sent).toMatchObject({
      id: INVITATION_ID,
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
      status: TeamInvitationStatus.PENDING,
      invitee: {
        id: INVITEE_ID,
        nickname: 'atomic-invitee',
        name: 'Synthetic user',
        avatarUrl: null,
      },
    });
    expect(Object.keys(sent!.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
    expect(sent).not.toHaveProperty('email');
    expect(sent!.invitee).not.toHaveProperty('studentId');
    expect(sent!.invitee).not.toHaveProperty('studentNo');
    expect(sent!.invitee).not.toHaveProperty('phone');
    expect(sent!.invitee).not.toHaveProperty('profile');
  });

  it('derives programId from the locked team row and returns the same invitee projection', async () => {
    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: FILLER_ID,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.invitation).toMatchObject({
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: FILLER_ID,
      invitedById: LEADER_ID,
      status: TeamInvitationStatus.PENDING,
    });
    expect(outcome.invitation.invitee).toEqual({
      id: FILLER_ID,
      nickname: 'atomic-filler',
      name: 'Synthetic user',
      avatarUrl: null,
    });
    expect(Object.keys(outcome.invitation.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
    await expect(
      prisma.teamInvitation.findUniqueOrThrow({
        where: { id: outcome.invitation.id },
        select: { programId: true, teamId: true },
      }),
    ).resolves.toEqual({ programId: PROGRAM_ID, teamId: TARGET_TEAM_ID });
  });

  it('returns already-invited instead of throwing when a pending invitation already exists', async () => {
    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: INVITEE_ID,
    });

    expect(outcome).toEqual({ kind: 'already-invited' });
    await expect(
      prisma.teamInvitation.count({ where: { teamId: TARGET_TEAM_ID } }),
    ).resolves.toBe(1);
  });

  it('rejects a non-leader actor without disclosing the invitee', async () => {
    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: FILLER_ID,
      inviteeId: OUTSIDER_ID,
    });

    expect(outcome).toEqual({ kind: 'not-team-leader' });
    await expect(
      prisma.teamInvitation.count({ where: { inviteeId: OUTSIDER_ID } }),
    ).resolves.toBe(0);
  });

  it('rejects a leader row that no longer has a membership row', async () => {
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: TARGET_TEAM_ID, userId: LEADER_ID } },
    });

    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: OUTSIDER_ID,
    });

    expect(outcome).toEqual({ kind: 'not-team-member' });
  });

  it('rejects an invitee that already belongs to a team in the same program', async () => {
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        programId: PROGRAM_ID,
        name: 'Other team',
        joinCodeDigest: `${TEST_PREFIX}other-digest`,
        leaderId: OUTSIDER_ID,
      },
    });
    await prisma.teamMember.create({
      data: {
        teamId: OTHER_TEAM_ID,
        programId: PROGRAM_ID,
        userId: OUTSIDER_ID,
      },
    });

    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: OUTSIDER_ID,
    });

    expect(outcome).toEqual({ kind: 'invitee-already-in-team' });
  });

  it('rejects a new invitation once the roster already fills the program capacity', async () => {
    await prisma.teamMember.create({
      data: {
        teamId: TARGET_TEAM_ID,
        programId: PROGRAM_ID,
        userId: FILLER_ID,
      },
    });

    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: OUTSIDER_ID,
    });

    expect(outcome).toEqual({ kind: 'team-full' });
  });

  it('keeps the invitation pending and creates no member when the team is full', async () => {
    await prisma.teamMember.create({
      data: {
        teamId: TARGET_TEAM_ID,
        programId: PROGRAM_ID,
        userId: FILLER_ID,
      },
    });

    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({ kind: 'team-full' });
    expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
    expect(invitation.respondedAt).toBeNull();
    expect(membership).toBeNull();
  });

  it('keeps the invitation pending when the invitee already belongs to another team', async () => {
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        programId: PROGRAM_ID,
        name: 'Other team',
        joinCodeDigest: `${TEST_PREFIX}other-digest`,
        leaderId: INVITEE_ID,
      },
    });
    await prisma.teamMember.create({
      data: {
        teamId: OTHER_TEAM_ID,
        programId: PROGRAM_ID,
        userId: INVITEE_ID,
      },
    });

    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({ kind: 'already-in-team' });
    expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
    expect(invitation.respondedAt).toBeNull();
    expect(membership).toBeNull();
  });

  it('creates one membership and accepts the invitation on success', async () => {
    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
    });
    expect(invitation.status).toBe(TeamInvitationStatus.ACCEPTED);
    expect(invitation.respondedAt).toEqual(RESPONDED_AT);
    expect(membership).toMatchObject({
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
      userId: INVITEE_ID,
    });

    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: TARGET_TEAM_ID },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
  });

  it('still joins the friend after the team already submitted an application', async () => {
    await seedApplication();

    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: TARGET_TEAM_ID,
      programId: PROGRAM_ID,
    });
    expect(invitation.status).toBe(TeamInvitationStatus.ACCEPTED);
    expect(membership).not.toBeNull();

    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: { applicantId: true, teamId: true, status: true },
      }),
    ).resolves.toEqual({
      applicantId: LEADER_ID,
      teamId: TARGET_TEAM_ID,
      status: ApplicationStatus.SUBMITTED,
    });
  });

  it('creates the invitation while the team already has an application', async () => {
    await seedApplication();

    const outcome = await repository.createInvitation({
      teamId: TARGET_TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: FILLER_ID,
    });

    expect(outcome.kind).toBe('ok');
    await expect(
      prisma.teamInvitation.count({
        where: { teamId: TARGET_TEAM_ID, inviteeId: FILLER_ID },
      }),
    ).resolves.toBe(1);
  });

  it('serializes duplicate concurrent acceptance into one success and one not-pending outcome', async () => {
    const outcomes = await Promise.all([
      repository.withAcceptTransaction(INVITATION_ID, INVITEE_ID, RESPONDED_AT),
      repository.withAcceptTransaction(INVITATION_ID, INVITEE_ID, RESPONDED_AT),
    ]);

    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'not-pending',
      'ok',
    ]);
    expect(invitation.status).toBe(TeamInvitationStatus.ACCEPTED);
    expect(invitation.respondedAt).toEqual(RESPONDED_AT);
    expect(membership).not.toBeNull();
    await expect(
      prisma.teamMember.count({
        where: { programId: PROGRAM_ID, userId: INVITEE_ID },
      }),
    ).resolves.toBe(1);
  });

  describe('repository access sync enqueue', () => {
    it('enqueues exactly one access sync event for the approved NEW application', async () => {
      await enableRepositoryProvisioning();
      await seedApplication({ status: ApplicationStatus.APPROVED });

      const outcome = await repository.withAcceptTransaction(
        INVITATION_ID,
        INVITEE_ID,
        RESPONDED_AT,
      );

      expect(outcome.kind).toBe('ok');
      const events = await storedAccessSyncEvents();
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event).toMatchObject({
        type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
        aggregateType: 'Application',
        aggregateId: APPLICATION_ID,
        idempotencyKey: `repository-access-sync:${APPLICATION_ID}:${RESPONDED_AT.toISOString()}`,
        status: OutboxEventStatus.PENDING,
        attemptCount: 0,
        processedAt: null,
      });
      expect(event!.availableAt).toEqual(RESPONDED_AT);

      expect(parseRepositoryAccessSyncEvent(event!.payload)).toEqual({
        applicationId: APPLICATION_ID,
        teamId: TARGET_TEAM_ID,
        requestedAt: RESPONDED_AT.toISOString(),
      });

      await expect(
        prisma.application.findUniqueOrThrow({
          where: { id: APPLICATION_ID },
          select: { status: true, teamId: true },
        }),
      ).resolves.toEqual({
        status: ApplicationStatus.APPROVED,
        teamId: TARGET_TEAM_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.count({
          where: { applicationId: APPLICATION_ID },
        }),
      ).resolves.toBe(0);
    });

    it('enqueues no event when the team has no application at all', async () => {
      await enableRepositoryProvisioning();

      const outcome = await repository.withAcceptTransaction(
        INVITATION_ID,
        INVITEE_ID,
        RESPONDED_AT,
      );

      expect(outcome.kind).toBe('ok');
      await expect(storedAccessSyncEvents()).resolves.toEqual([]);
    });

    it.each([
      [
        'the application is still awaiting a decision',
        { status: ApplicationStatus.SUBMITTED },
        true,
      ],
      [
        'the application was rejected',
        { status: ApplicationStatus.REJECTED },
        true,
      ],
      [
        'the approved application connects an OWN repository',
        {
          status: ApplicationStatus.APPROVED,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
        },
        true,
      ],
      [
        'repository provisioning is disabled for the program',
        { status: ApplicationStatus.APPROVED },
        false,
      ],
    ] as const)(
      'enqueues no event when %s',
      async (_label, application, provisioningEnabled) => {
        if (provisioningEnabled) await enableRepositoryProvisioning();
        await seedApplication(application);

        const outcome = await repository.withAcceptTransaction(
          INVITATION_ID,
          INVITEE_ID,
          RESPONDED_AT,
        );

        expect(outcome.kind).toBe('ok');
        const [, membership] = await storedInvitationAndTargetMembership();
        expect(membership).not.toBeNull();
        await expect(storedAccessSyncEvents()).resolves.toEqual([]);
      },
    );

    it('enqueues no event when the team is full and nobody joins', async () => {
      await enableRepositoryProvisioning();
      await seedApplication({ status: ApplicationStatus.APPROVED });
      await prisma.teamMember.create({
        data: {
          teamId: TARGET_TEAM_ID,
          programId: PROGRAM_ID,
          userId: FILLER_ID,
        },
      });

      const outcome = await repository.withAcceptTransaction(
        INVITATION_ID,
        INVITEE_ID,
        RESPONDED_AT,
      );

      const [invitation, membership] =
        await storedInvitationAndTargetMembership();
      expect(outcome).toEqual({ kind: 'team-full' });
      expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
      expect(membership).toBeNull();
      await expect(storedAccessSyncEvents()).resolves.toEqual([]);
    });

    it('enqueues no event when the invitee already belongs to another team', async () => {
      await enableRepositoryProvisioning();
      await seedApplication({ status: ApplicationStatus.APPROVED });
      await prisma.team.create({
        data: {
          id: OTHER_TEAM_ID,
          programId: PROGRAM_ID,
          name: 'Other team',
          joinCodeDigest: `${TEST_PREFIX}other-digest`,
          leaderId: INVITEE_ID,
        },
      });
      await prisma.teamMember.create({
        data: {
          teamId: OTHER_TEAM_ID,
          programId: PROGRAM_ID,
          userId: INVITEE_ID,
        },
      });

      const outcome = await repository.withAcceptTransaction(
        INVITATION_ID,
        INVITEE_ID,
        RESPONDED_AT,
      );

      expect(outcome).toEqual({ kind: 'already-in-team' });
      await expect(storedAccessSyncEvents()).resolves.toEqual([]);
    });

    it('enqueues one event for duplicate concurrent acceptance of one invitation', async () => {
      await enableRepositoryProvisioning();
      await seedApplication({ status: ApplicationStatus.APPROVED });

      const outcomes = await Promise.all([
        repository.withAcceptTransaction(
          INVITATION_ID,
          INVITEE_ID,
          RESPONDED_AT,
        ),
        repository.withAcceptTransaction(
          INVITATION_ID,
          INVITEE_ID,
          RESPONDED_AT,
        ),
      ]);

      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
        'not-pending',
        'ok',
      ]);
      await expect(storedAccessSyncEvents()).resolves.toHaveLength(1);
    });
  });
});
