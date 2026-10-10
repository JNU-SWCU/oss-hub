import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  ProgramCategory,
  ProgramTrackType,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramTeamsRepository } from '../../programs/repository/program-teams.repository';
import { canonicalUserCreateFromLabel } from '../../users/canonical-user-fixture';
import {
  backendPid,
  deferred,
  pidCapturingPrisma,
  releaseAfterBlocked,
} from './team-invitations.acceptance-race.test-support';
import { TeamInvitationsRepository } from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const TEST_PREFIX = 'team-invitation-acceptance-race:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TEAM_ID = `${TEST_PREFIX}team`;
const INVITATION_ID = `${TEST_PREFIX}invitation`;
const SECOND_INVITATION_ID = `${TEST_PREFIX}invitation-second`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const MEMBER_ID = `${TEST_PREFIX}member`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const SECOND_INVITEE_ID = `${TEST_PREFIX}invitee-second`;
const prisma = new PrismaService();

async function seedFixture(): Promise<void> {
  for (const [id, githubId, nickname] of [
    [LEADER_ID, 9_301_000_001n, 'acceptance-race-leader'],
    [INVITEE_ID, 9_301_000_002n, 'acceptance-race-invitee'],
    [MEMBER_ID, 9_301_000_003n, 'acceptance-race-member'],
    [SECOND_INVITEE_ID, 9_301_000_004n, 'acceptance-race-invitee-second'],
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
      name: 'Invitation acceptance race program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic invitation acceptance race fixture',
      teamMinSize: 1,

      teamMaxSize: 3,
    },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'Acceptance race team',
      joinCodeDigest: `${TEST_PREFIX}digest`,
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.createMany({
    data: [
      { teamId: TEAM_ID, programId: PROGRAM_ID, userId: LEADER_ID },
      { teamId: TEAM_ID, programId: PROGRAM_ID, userId: MEMBER_ID },
    ],
  });
  await prisma.teamInvitation.createMany({
    data: [
      {
        id: INVITATION_ID,
        teamId: TEAM_ID,
        programId: PROGRAM_ID,
        inviteeId: INVITEE_ID,
        invitedById: LEADER_ID,
      },
      {
        id: SECOND_INVITATION_ID,
        teamId: TEAM_ID,
        programId: PROGRAM_ID,
        inviteeId: SECOND_INVITEE_ID,
        invitedById: LEADER_ID,
      },
    ],
  });
}

async function cleanup(): Promise<void> {
  await prisma.teamInvitation.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

const pausedReleases: { readonly resolve: () => void }[] = [];
const pausedOperations: Promise<unknown>[] = [];

function trackPaused<T>(
  operation: Promise<T>,
  release: { readonly resolve: () => void },
): Promise<T> {
  pausedReleases.push(release);

  pausedOperations.push(operation.catch(() => undefined));
  return operation;
}

async function releasePausedTransactions(): Promise<void> {
  for (const release of pausedReleases) release.resolve();
  await Promise.allSettled(pausedOperations);
  pausedReleases.length = 0;
  pausedOperations.length = 0;
}

function startPausedLeaderLeave(): {
  readonly leaving: Promise<string>;
  readonly pid: Promise<number>;
  readonly paused: Promise<void>;
  readonly release: { readonly resolve: () => void };
} {
  const leaveBackend = backendPid();
  const paused = deferred();
  const release = deferred();
  const teams = new ProgramTeamsRepository(
    pidCapturingPrisma(prisma, leaveBackend.capture),
  );
  const leaving = trackPaused(
    teams.leave(PROGRAM_ID, LEADER_ID, async () => {
      paused.resolve();
      await release.promise;
    }),
    release,
  );
  return {
    leaving,
    pid: leaveBackend.pid,
    paused: paused.promise,
    release,
  };
}

async function expectPendingWithoutMembership(): Promise<void> {
  const [invitation, membership] = await Promise.all([
    prisma.teamInvitation.findUniqueOrThrow({ where: { id: INVITATION_ID } }),
    prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: TEAM_ID, userId: INVITEE_ID } },
    }),
  ]);
  expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
  expect(invitation.respondedAt).toBeNull();
  expect(membership).toBeNull();
}

describe('Team invitation acceptance transaction races', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    await cleanup();
    await seedFixture();
  });

  afterEach(async () => {
    await releasePausedTransactions();
    await cleanup();
  });
  afterAll(async () => {
    await releasePausedTransactions();
    await cleanup();
    await prisma.$disconnect();
  });

  it.each([
    [
      '역할 변경 트랜잭션',
      {
        hasStaffAccess: true,
        selectedMemberKind: MemberKind.STAFF,
        profile: {
          update: {
            memberKind: MemberKind.STAFF,
            studentId: null,
            affiliationKind: AffiliationKind.PROGRAM_OFFICE,
            department: 'Synthetic program office',
            affiliationName: 'Synthetic program office',
          },
        },
      },
    ],
    ['계정 비활성화 트랜잭션', { accountStatus: AccountStatus.DEACTIVATED }],
  ] as const)(
    '%s이 먼저 잠그면 수락은 대기 후 최신 자격을 본다',
    async (_, updateData) => {
      const updateBackend = backendPid();
      const acceptBackend = backendPid();
      const updated = deferred();
      const releaseUpdate = deferred();
      const update = trackPaused(
        pidCapturingPrisma(prisma, updateBackend.capture).$transaction(
          async (transaction) => {
            await transaction.user.update({
              where: { id: INVITEE_ID },
              data: updateData,
            });
            updated.resolve();
            await releaseUpdate.promise;
          },
        ),
        releaseUpdate,
      );
      await updated.promise;

      const acceptance = new TeamInvitationsRepository(
        pidCapturingPrisma(prisma, acceptBackend.capture),
      ).withAcceptTransaction(INVITATION_ID, INVITEE_ID);
      await releaseAfterBlocked(
        prisma,
        acceptBackend.pid,
        updateBackend.pid,
        releaseUpdate,
        [update, acceptance],
      );

      const [, outcome] = await Promise.all([update, acceptance]);
      expect(outcome).toEqual({ kind: 'invitee-not-eligible' });
      await expectPendingWithoutMembership();
    },
  );

  it('팀장 탈퇴가 먼저 잠그면 수락은 대기 후 승계된 팀에 합류한다', async () => {
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const acceptBackend = backendPid();

    const acceptance = new TeamInvitationsRepository(
      pidCapturingPrisma(prisma, acceptBackend.capture),
    ).withAcceptTransaction(INVITATION_ID, INVITEE_ID);
    await releaseAfterBlocked(
      prisma,
      acceptBackend.pid,
      leave.pid,
      leave.release,
      [leave.leaving, acceptance],
    );

    const [leaveResult, outcome] = await Promise.all([
      leave.leaving,
      acceptance,
    ]);
    expect(leaveResult).toBe('removed');
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
    });
    const [team, members] = await Promise.all([
      prisma.team.findUniqueOrThrow({
        where: { id: TEAM_ID },
        select: { leaderId: true },
      }),
      prisma.teamMember.findMany({
        where: { teamId: TEAM_ID },
        select: { userId: true },
      }),
    ]);

    expect(team.leaderId).toBe(MEMBER_ID);
    expect(members.map((member) => member.userId).sort()).toEqual(
      [MEMBER_ID, INVITEE_ID].sort(),
    );
  });

  it('팀장 탈퇴가 먼저 잠그면 낡은 팀장의 새 초대는 대기 후 거부된다', async () => {
    await prisma.teamInvitation.delete({
      where: { id: SECOND_INVITATION_ID },
    });
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const inviteBackend = backendPid();

    const invitation = new TeamInvitationsRepository(
      pidCapturingPrisma(prisma, inviteBackend.capture),
    ).createInvitation({
      teamId: TEAM_ID,
      actorId: LEADER_ID,
      inviteeId: SECOND_INVITEE_ID,
    });
    await releaseAfterBlocked(
      prisma,
      inviteBackend.pid,
      leave.pid,
      leave.release,
      [leave.leaving, invitation],
    );

    const [leaveResult, outcome] = await Promise.all([
      leave.leaving,
      invitation,
    ]);
    expect(leaveResult).toBe('removed');
    expect(outcome).toEqual({ kind: 'not-team-leader' });

    await expect(
      prisma.teamInvitation.count({ where: { teamId: TEAM_ID } }),
    ).resolves.toBe(1);
    await expect(
      prisma.teamInvitation.count({
        where: { teamId: TEAM_ID, inviteeId: SECOND_INVITEE_ID },
      }),
    ).resolves.toBe(0);
  });

  it('팀장 탈퇴가 먼저 잠그면 낡은 팀장의 취소는 거부되고 승계된 팀장이 정리한다', async () => {
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const cancelBackend = backendPid();
    const invitations = new TeamInvitationsRepository(prisma);

    const staleCancel = new TeamInvitationsRepository(
      pidCapturingPrisma(prisma, cancelBackend.capture),
    ).cancelPendingInvitationAsLeader(INVITATION_ID, LEADER_ID);
    await releaseAfterBlocked(
      prisma,
      cancelBackend.pid,
      leave.pid,
      leave.release,
      [leave.leaving, staleCancel],
    );

    const [leaveResult, staleOutcome] = await Promise.all([
      leave.leaving,
      staleCancel,
    ]);
    expect(leaveResult).toBe('removed');
    expect(staleOutcome).toEqual({ kind: 'not-team-leader' });
    await expect(
      prisma.teamInvitation.findUniqueOrThrow({
        where: { id: INVITATION_ID },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: TeamInvitationStatus.PENDING });

    await expect(
      invitations.cancelPendingInvitationAsLeader(INVITATION_ID, MEMBER_ID),
    ).resolves.toEqual({ kind: 'ok' });
    const cancelled = await prisma.teamInvitation.findUniqueOrThrow({
      where: { id: INVITATION_ID },
      select: { status: true, respondedAt: true },
    });
    expect(cancelled.status).toBe(TeamInvitationStatus.DECLINED);
    expect(cancelled.respondedAt).not.toBeNull();
  });

  it('마지막 한 자리를 두고 동시에 수락하면 정확히 한 명만 합류한다', async () => {
    const first = new TeamInvitationsRepository(prisma);
    const second = new TeamInvitationsRepository(prisma);

    const outcomes = await Promise.all([
      first.withAcceptTransaction(INVITATION_ID, INVITEE_ID),
      second.withAcceptTransaction(SECOND_INVITATION_ID, SECOND_INVITEE_ID),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'ok',
      'team-full',
    ]);
    const members = await prisma.teamMember.findMany({
      where: { teamId: TEAM_ID },
      select: { userId: true },
    });

    expect(members).toHaveLength(3);
    const joined = members
      .map((member) => member.userId)
      .filter(
        (userId) => userId === INVITEE_ID || userId === SECOND_INVITEE_ID,
      );
    expect(joined).toHaveLength(1);

    const invitations = await prisma.teamInvitation.findMany({
      where: { teamId: TEAM_ID },
      select: { inviteeId: true, status: true },
      orderBy: { id: 'asc' },
    });
    const accepted = invitations.filter(
      (invitation) => invitation.status === TeamInvitationStatus.ACCEPTED,
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.inviteeId).toBe(joined[0]);
    expect(
      invitations.filter(
        (invitation) => invitation.status === TeamInvitationStatus.PENDING,
      ),
    ).toHaveLength(1);
  });
});
