import {
  AffiliationKind,
  MemberKind,
  ProgramCategory,
  TeamInvitationStatus,
  ProgramTrackType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'team-invitation-received-summary:';
const PROGRAM_A_ID = `${TEST_PREFIX}program-a`;
const PROGRAM_B_ID = `${TEST_PREFIX}program-b`;
const TEAM_A_ID = `${TEST_PREFIX}team-a`;
const TEAM_B_ID = `${TEST_PREFIX}team-b`;
const PENDING_A_ID = `${TEST_PREFIX}pending-a`;
const PENDING_B_ID = `${TEST_PREFIX}pending-b`;
const DECLINED_A_ID = `${TEST_PREFIX}declined-a`;
const NAMED_LEADER_ID = `${TEST_PREFIX}named-leader`;
const LEGACY_LEADER_ID = `${TEST_PREFIX}legacy-leader`;
const HANDLE_ONLY_LEADER_ID = `${TEST_PREFIX}handle-only-leader`;
const MEMBER_ID = `${TEST_PREFIX}member`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;

const NAMED_LEADER_PROFILE_NAME = '김초대';
const LEGACY_LEADER_NAME = '레거시 초대자';
const HANDLE_ONLY_LEADER_HANDLE = 'summary-handle-only-leader';
const TEAM_A_NAME = '요약 대상 팀';
const TEAM_B_NAME = '다른 프로그램 팀';
const PROGRAM_A_NAME = '초대 요약 프로그램 A';
const PROGRAM_B_NAME = '초대 요약 프로그램 B';

const prisma = new PrismaService();
const repository = new TeamInvitationsRepository(prisma);

async function cleanup(): Promise<void> {
  await prisma.teamInvitation.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: { in: [PROGRAM_A_ID, PROGRAM_B_ID] } },
  });
  await prisma.team.deleteMany({
    where: { programId: { in: [PROGRAM_A_ID, PROGRAM_B_ID] } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: [PROGRAM_A_ID, PROGRAM_B_ID] } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

function programData(
  id: string,
  name: string,
  teamMaxSize: number,
): Prisma.ProgramCreateManyInput {
  return {
    id,
    name,
    organizer: 'Synthetic organizer',
    trackType: ProgramTrackType.CURRICULAR,
    category: ProgramCategory.BASIC,
    applicationTemplateKey: 'capstone-v1',
    applicationTemplateVersion: 1,
    applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
    description: 'Synthetic received-invitation summary fixture',
    teamMinSize: 1,
    teamMaxSize,
  };
}

async function seed(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: NAMED_LEADER_ID,
        githubId: 9_200_000_001n,
        nickname: 'summary-named-leader',
      },
      {
        id: LEGACY_LEADER_ID,
        githubId: 9_200_000_005n,
        nickname: 'summary-legacy-leader',
      },
      {
        id: HANDLE_ONLY_LEADER_ID,
        githubId: 9_200_000_002n,
        nickname: HANDLE_ONLY_LEADER_HANDLE,
      },
      { id: MEMBER_ID, githubId: 9_200_000_003n, nickname: 'summary-member' },
      { id: INVITEE_ID, githubId: 9_200_000_004n, nickname: 'summary-invitee' },
    ],
  });

  await prisma.userProfile.createMany({
    data: [
      {
        userId: NAMED_LEADER_ID,
        name: NAMED_LEADER_PROFILE_NAME,
        studentId: '920001',
        department: 'Synthetic department',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: 'Synthetic department',
      },
      {
        userId: LEGACY_LEADER_ID,
        name: LEGACY_LEADER_NAME,
        studentId: '920005',
        department: 'Synthetic department',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: 'Synthetic department',
      },
    ],
  });
  await prisma.program.createMany({
    data: [
      programData(PROGRAM_A_ID, PROGRAM_A_NAME, 4),
      programData(PROGRAM_B_ID, PROGRAM_B_NAME, 2),
    ],
  });
  await prisma.team.createMany({
    data: [
      {
        id: TEAM_A_ID,
        programId: PROGRAM_A_ID,
        name: TEAM_A_NAME,
        joinCodeDigest: `${TEST_PREFIX}digest-a`,
        leaderId: NAMED_LEADER_ID,
      },
      {
        id: TEAM_B_ID,
        programId: PROGRAM_B_ID,
        name: TEAM_B_NAME,
        joinCodeDigest: `${TEST_PREFIX}digest-b`,
        leaderId: HANDLE_ONLY_LEADER_ID,
      },
    ],
  });

  await prisma.teamMember.createMany({
    data: [
      { teamId: TEAM_A_ID, programId: PROGRAM_A_ID, userId: NAMED_LEADER_ID },
      { teamId: TEAM_A_ID, programId: PROGRAM_A_ID, userId: MEMBER_ID },
      {
        teamId: TEAM_B_ID,
        programId: PROGRAM_B_ID,
        userId: HANDLE_ONLY_LEADER_ID,
      },
    ],
  });
  await prisma.teamInvitation.createMany({
    data: [
      {
        id: DECLINED_A_ID,
        teamId: TEAM_A_ID,
        programId: PROGRAM_A_ID,
        inviteeId: INVITEE_ID,
        invitedById: LEGACY_LEADER_ID,
        status: TeamInvitationStatus.DECLINED,
        invitedAt: new Date('2026-08-01T00:00:00.000Z'),
        respondedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      {
        id: PENDING_B_ID,
        teamId: TEAM_B_ID,
        programId: PROGRAM_B_ID,
        inviteeId: INVITEE_ID,
        invitedById: HANDLE_ONLY_LEADER_ID,
        invitedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
      {
        id: PENDING_A_ID,
        teamId: TEAM_A_ID,
        programId: PROGRAM_A_ID,
        inviteeId: INVITEE_ID,
        invitedById: NAMED_LEADER_ID,
        invitedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    ],
  });
}

describe('TeamInvitationsRepository received invitation summary integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('carries the team, program, inviter and capacity of every received invitation', async () => {
    const invitations = await repository.findByInviteeId(INVITEE_ID);

    const pendingA = invitations.find(
      (invitation) => invitation.id === PENDING_A_ID,
    );
    expect(pendingA).toMatchObject({
      teamId: TEAM_A_ID,
      programId: PROGRAM_A_ID,
      teamName: TEAM_A_NAME,
      programName: PROGRAM_A_NAME,
      invitedByDisplayName: NAMED_LEADER_PROFILE_NAME,
      memberCount: 2,
      teamMaxSize: 4,
    });
    await expect(
      prisma.teamMember.count({
        where: { userId: INVITEE_ID },
      }),
    ).resolves.toBe(0);
  });

  it('falls back to the legacy name only when the inviter has no profile', async () => {
    const invitations = await repository.findByInviteeId(INVITEE_ID);
    const legacyInvitation = invitations.find(
      (invitation) => invitation.id === DECLINED_A_ID,
    );

    expect(legacyInvitation?.invitedByDisplayName).toBe(LEGACY_LEADER_NAME);
  });

  it('reads capacity per team rather than reusing the first team', async () => {
    const invitations = await repository.findByInviteeId(INVITEE_ID);

    const pendingB = invitations.find(
      (invitation) => invitation.id === PENDING_B_ID,
    );
    expect(pendingB).toMatchObject({
      teamName: TEAM_B_NAME,
      programName: PROGRAM_B_NAME,
      memberCount: 1,
      teamMaxSize: 2,
    });
  });

  it('falls back to the GitHub handle when the inviter has no real name', async () => {
    const invitations = await repository.findByInviteeId(INVITEE_ID);

    expect(
      invitations.find((invitation) => invitation.id === PENDING_B_ID)
        ?.invitedByDisplayName,
    ).toBe(HANDLE_ONLY_LEADER_HANDLE);
  });

  it('returns responded invitations too, newest first', async () => {
    const invitations = await repository.findByInviteeId(INVITEE_ID);

    expect(invitations.map((invitation) => invitation.id)).toEqual([
      PENDING_A_ID,
      PENDING_B_ID,
      DECLINED_A_ID,
    ]);
    expect(
      invitations.find((invitation) => invitation.id === DECLINED_A_ID)?.status,
    ).toBe(TeamInvitationStatus.DECLINED);
  });
});
