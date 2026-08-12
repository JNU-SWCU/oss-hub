import {
  AccountStatus,
  ProgramCategory,
  Role,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
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
const LEADER_ID = `${TEST_PREFIX}leader`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const FILLER_ID = `${TEST_PREFIX}filler`;
const RESPONDED_AT = new Date('2026-08-10T00:00:00.000Z');
const prisma = new PrismaService();
const repository = new TeamInvitationsRepository(prisma);

async function cleanup(): Promise<void> {
  await prisma.teamInvitation.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: PROGRAM_ID },
  });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function seedPendingInvitation(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: LEADER_ID,
        githubId: 9_100_000_001n,
        nickname: 'atomic-leader',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: INVITEE_ID,
        githubId: 9_100_000_002n,
        nickname: 'atomic-invitee',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: FILLER_ID,
        githubId: 9_100_000_003n,
        nickname: 'atomic-filler',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Invitation atomicity program',
      organizer: 'Synthetic organizer',
      category: ProgramCategory.CAPSTONE,
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

  it('keeps the invitation pending and creates no member when the team is full', async () => {
    // Given
    await prisma.teamMember.create({
      data: {
        teamId: TARGET_TEAM_ID,
        programId: PROGRAM_ID,
        userId: FILLER_ID,
      },
    });

    // When
    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    // Then
    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({ kind: 'team-full' });
    expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
    expect(invitation.respondedAt).toBeNull();
    expect(membership).toBeNull();
  });

  it('keeps the invitation pending when the invitee already belongs to another team', async () => {
    // Given
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

    // When
    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    // Then
    const [invitation, membership] =
      await storedInvitationAndTargetMembership();
    expect(outcome).toEqual({ kind: 'already-in-team' });
    expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
    expect(invitation.respondedAt).toBeNull();
    expect(membership).toBeNull();
  });

  it('creates one membership and accepts the invitation on success', async () => {
    // When
    const outcome = await repository.withAcceptTransaction(
      INVITATION_ID,
      INVITEE_ID,
      RESPONDED_AT,
    );

    // Then
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
  });

  it('serializes duplicate concurrent acceptance into one success and one not-pending outcome', async () => {
    // When
    const outcomes = await Promise.all([
      repository.withAcceptTransaction(INVITATION_ID, INVITEE_ID, RESPONDED_AT),
      repository.withAcceptTransaction(INVITATION_ID, INVITEE_ID, RESPONDED_AT),
    ]);

    // Then
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
});
