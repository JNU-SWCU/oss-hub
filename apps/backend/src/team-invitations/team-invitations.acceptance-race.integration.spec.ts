import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  ProgramCategory,
  ProgramTrackType,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamsRepository } from '../programs/repository/program-teams.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import {
  backendPid,
  deferred,
  pidCapturingPrisma,
  releaseAfterBlocked,
} from './team-invitations.acceptance-race.test-support';
import { TeamInvitationsRepository } from './team-invitations.repository';

/**
 * 초대 트랜잭션이 **지금 팀 행을 잠그는 상대**와 어떻게 직렬화되는지 확인한다(#1269).
 *
 * 경쟁 상대가 바뀌었다. 예전에는 신청 생성이 팀을 잠그고 초대·수락을 `team-locked`로
 * 되돌려보냈지만, 신청은 더 이상 팀 구성의 게이트가 아니다. 지금 같은 Team 행을 두고
 * 싸우는 쓰기는 **탈퇴·제외로 인한 팀장 승계**다. 그래서 이 파일이 지키는 사실은
 * "잠금 뒤에 다시 읽은 팀장이 정본이다" — 잠금을 기다린 초대자/취소자는 낡은 권한으로
 * 통과하지 못하고, 승계받은 팀장은 전 팀장이 남긴 대기 초대를 정리할 수 있다.
 */
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
      // 팀장 + 팀원 2명을 채우면 남는 자리는 정확히 하나다 — 마지막 한 자리를 두고
      // 벌어지는 동시 수락이 이 정원 위에서 관측된다.
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

/**
 * `AuditLog`은 지우지 않는다 — DB 가 추가 전용을 강제해 DELETE 자체가 거부된다
 * (`audit-log-append-only.integration.spec.ts`). 이 파일은 감사 행을 남기지 않는다 —
 * 탈퇴를 멈춰 세우는 콜백은 잠금만 잡고 아무것도 기록하지 않고, 수락은 `onOk` 없이
 * 호출한다. 그래서 사용자 행을 감사 FK 충돌 없이 지울 수 있다.
 */
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

/**
 * 일부러 멈춰 세운 트랜잭션을 추적한다.
 *
 * 이 파일의 경합 시나리오는 전부 "한 쪽이 행을 잠근 채 멈춰 있다"로 시작한다. 그 상태에서
 * 단언이 먼저 실패하면 `releaseAfterBlocked` 까지 도달하지 못해 interactive
 * transaction 이 열린 채로 남고, 그게 그대로 러너의 open-handle 경고가 된다. 테스트
 * 결과와 무관하게 후정리가 반드시 잠금을 풀도록 여기 등록해 둔다 — 실패를 감추는
 * 게 아니라 실패했을 때도 리소스를 닫는 것이다(forceExit 는 쓰지 않는다).
 */
const pausedReleases: { readonly resolve: () => void }[] = [];
const pausedOperations: Promise<unknown>[] = [];

function trackPaused<T>(
  operation: Promise<T>,
  release: { readonly resolve: () => void },
): Promise<T> {
  pausedReleases.push(release);
  // 원본 promise 에 핸들러를 붙여 unhandled rejection 을 막는다. 테스트는 여전히
  // 자기가 받은 `operation` 을 await 해 진짜 결과를 단언한다.
  pausedOperations.push(operation.catch(() => undefined));
  return operation;
}

async function releasePausedTransactions(): Promise<void> {
  for (const release of pausedReleases) release.resolve();
  await Promise.allSettled(pausedOperations);
  pausedReleases.length = 0;
  pausedOperations.length = 0;
}

/**
 * 팀장 탈퇴 트랜잭션을 **팀 행을 잠근 채** 멈춰 세운다.
 *
 * 멈추는 자리는 같은 트랜잭션의 감사 콜백이다 — 승계와 멤버 행 삭제가 이미 끝났고
 * 커밋 전이라, 이 구간에 들어온 다른 쓰기는 낡은 팀장 스냅샷을 들고 잠금을 기다린다.
 * 감사 기록 자체는 여기서 관심사가 아니라 아무것도 쓰지 않는다.
 */
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
  // 정리 전에 멈춰 둔 트랜잭션을 먼저 풀어준다 — 잠금을 쥐고 있는 행을 지우려 들면
  // 정리 자체가 그 잠금에 막힌다.
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
    // Given — 팀장이 나가는 트랜잭션이 승계까지 마치고 팀 행을 쥔 채 멈춰 있다.
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const acceptBackend = backendPid();

    // When
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

    // Then — 수락은 실패하지 않는다. 팀 구성 변경은 서로 직렬화될 뿐이다.
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
    // 승계된 팀장은 여전히 구성원이고, 합류자는 팀장이 되지 않는다.
    expect(team.leaderId).toBe(MEMBER_ID);
    expect(members.map((member) => member.userId).sort()).toEqual(
      [MEMBER_ID, INVITEE_ID].sort(),
    );
  });

  it('팀장 탈퇴가 먼저 잠그면 낡은 팀장의 새 초대는 대기 후 거부된다', async () => {
    // Given — 이 대상에게는 대기 초대가 없다. 거부 사유를 `already-invited`와
    // 헷갈리지 않게 정확히 "낡은 팀장" 하나로 좁힌다.
    await prisma.teamInvitation.delete({
      where: { id: SECOND_INVITATION_ID },
    });
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const inviteBackend = backendPid();

    // When — 나가는 중인 전 팀장이 잠금 전 스냅샷으로 초대를 시작한다.
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

    // Then — 잠금 뒤 팀장은 승계자다. 예외가 아니라 outcome으로 거부된다.
    const [leaveResult, outcome] = await Promise.all([
      leave.leaving,
      invitation,
    ]);
    expect(leaveResult).toBe('removed');
    expect(outcome).toEqual({ kind: 'not-team-leader' });
    // 아무 초대도 만들어지지 않았다.
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
    // Given
    const leave = startPausedLeaderLeave();
    await leave.paused;
    const cancelBackend = backendPid();
    const invitations = new TeamInvitationsRepository(prisma);

    // When — 전 팀장이 자기가 보냈던 대기 초대를 취소하려 한다.
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

    // Then — 이미 떠난 사람은 정리할 수 없고 초대는 그대로 대기 상태다.
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

    // And — 승계받은 팀장은 전 팀장이 남긴 초대를 정리할 수 있다.
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
    // Given — teamMaxSize 3, 현재 2명. 남은 자리는 하나이고 대기 초대는 둘이다.
    const first = new TeamInvitationsRepository(prisma);
    const second = new TeamInvitationsRepository(prisma);

    // When
    const outcomes = await Promise.all([
      first.withAcceptTransaction(INVITATION_ID, INVITEE_ID),
      second.withAcceptTransaction(SECOND_INVITATION_ID, SECOND_INVITEE_ID),
    ]);

    // Then — 승자는 정확히 하나, 패자는 정원 초과로 막힌다.
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'ok',
      'team-full',
    ]);
    const members = await prisma.teamMember.findMany({
      where: { teamId: TEAM_ID },
      select: { userId: true },
    });
    // 정원을 절대 넘지 않는다.
    expect(members).toHaveLength(3);
    const joined = members
      .map((member) => member.userId)
      .filter(
        (userId) => userId === INVITEE_ID || userId === SECOND_INVITEE_ID,
      );
    expect(joined).toHaveLength(1);

    // 진 쪽 초대는 대기 상태로 남고, 이긴 쪽만 ACCEPTED 다.
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
