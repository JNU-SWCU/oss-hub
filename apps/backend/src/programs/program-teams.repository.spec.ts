import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import {
  ApplicationStatus,
  Prisma,
  RepositoryConnectionMode,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  TeamRepository,
  type RecordTeamMembershipAudit,
  type TeamMembershipAuditEvent,
} from './team.repository';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../platform/repository-access-sync.config';
import { PlatformRepository } from '../platform/platform.repository';
import { TeamHistoryRepository } from './team-history.repository';

const syntheticTeamId = 'cuid-synthetic-team';
const syntheticOtherTeamId = 'cuid-synthetic-other-team';
const syntheticProgramId = 'program-synthetic';
const syntheticLeaderId = 'user-synthetic-leader';
const syntheticMemberId = 'user-synthetic-member';
const syntheticSecondMemberId = 'user-synthetic-member-2';
const syntheticProgramName = '합성 프로그램';
const syntheticTeamName = '오픈소스팀';

function buildRepository(tx: object) {
  const prisma = {
    $transaction: <T>(operation: (t: typeof tx) => Promise<T>) => operation(tx),
  };
  return new TeamRepository(
    prisma as unknown as PrismaService,
    new ProgramTeamRepositoryEvidenceRepository(
      prisma as unknown as PrismaService,
    ),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  );
}

function teamContext(leaderId: string) {
  return {
    teamId: syntheticTeamId,
    team: {
      leaderId,
      name: syntheticTeamName,
      program: { name: syntheticProgramName },
    },
  };
}

type MembershipRow = { readonly teamId: string } | null;

type RecordAuditMock = jest.Mock<
  Promise<void>,
  Parameters<RecordTeamMembershipAudit>
>;

function createRecordAuditMock(): RecordAuditMock {
  return jest
    .fn<Promise<void>, Parameters<RecordTeamMembershipAudit>>()
    .mockResolvedValue(undefined);
}

interface TxOptions {
  readonly preLockMembership?: MembershipRow;

  readonly lockedMembership?: ReturnType<typeof teamContext> | null;
  readonly targetMembership?: MembershipRow;
  readonly memberCount?: number;
  readonly status?: ApplicationStatus;
  readonly successor?: { readonly userId: string } | null;

  readonly accessSyncTeams?: readonly { readonly id: string }[];
  readonly recordAudit?: RecordAuditMock;
}

function buildTx(actorUserId: string, options: TxOptions = {}) {
  const state = { locked: false };
  const queryRaw = jest.fn<Promise<{ id: string }[]>, [Prisma.Sql]>(() => {
    state.locked = true;
    return Promise.resolve([{ id: syntheticTeamId }]);
  });
  const findUnique = jest.fn(
    (args: {
      where: { programId_userId: { userId: string } };
    }): Promise<unknown> => {
      const { userId } = args.where.programId_userId;
      if (userId !== actorUserId) {
        return Promise.resolve(
          options.targetMembership === undefined
            ? { teamId: syntheticTeamId }
            : options.targetMembership,
        );
      }
      if (!state.locked) {
        return Promise.resolve(
          options.preLockMembership === undefined
            ? { teamId: syntheticTeamId }
            : options.preLockMembership,
        );
      }
      return Promise.resolve(
        options.lockedMembership === undefined
          ? teamContext(actorUserId)
          : options.lockedMembership,
      );
    },
  );
  const findFirstMember = jest
    .fn()
    .mockResolvedValue(
      options.successor === undefined
        ? { userId: syntheticMemberId }
        : options.successor,
    );
  const count = jest.fn().mockResolvedValue(options.memberCount ?? 1);
  const teamFindUniqueOrThrow = jest.fn().mockResolvedValue({
    id: syntheticTeamId,
    programId: syntheticProgramId,
    name: syntheticTeamName,
    leaderId: options.lockedMembership?.team.leaderId ?? actorUserId,
    status: options.status ?? ApplicationStatus.SUBMITTED,
    members: [
      {
        userId: actorUserId,
        user: { name: 'Synthetic member', nickname: 'synthetic-member' },
      },
    ],
  });
  const teamFindMany = jest
    .fn()
    .mockResolvedValue(options.accessSyncTeams ?? []);
  const outboxCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const teamMemberDelete = jest.fn().mockResolvedValue({});
  const teamInvitationDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const teamDelete = jest.fn().mockResolvedValue({});
  const teamUpdate = jest.fn().mockResolvedValue({});
  const recordAudit = options.recordAudit ?? createRecordAuditMock();

  const tx = {
    teamMember: {
      count,
      findUnique,
      findFirst: findFirstMember,
      delete: teamMemberDelete,
    },
    teamInvitation: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: teamInvitationDeleteMany,
    },
    team: {
      update: teamUpdate,
      delete: teamDelete,
      findUniqueOrThrow: teamFindUniqueOrThrow,
      findMany: teamFindMany,
    },
    teamHistory: {
      create: jest.fn().mockResolvedValue({ id: 'synthetic-history' }),
    },
    milestoneDocumentSubmission: { count: jest.fn().mockResolvedValue(0) },
    githubRepository: { count: jest.fn().mockResolvedValue(0) },
    submissionFile: { count: jest.fn().mockResolvedValue(0) },
    repositoryProvisionJob: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    outboxEvent: {
      createMany: outboxCreateMany,
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: queryRaw,
  };

  return {
    tx,
    queryRaw,
    findUnique,
    findFirstMember,
    count,
    teamFindUniqueOrThrow,
    teamFindMany,
    outboxCreateMany,
    teamMemberDelete,
    teamInvitationDeleteMany,
    teamDelete,
    teamUpdate,
    recordAudit,
  };
}

function auditEventOf(recordAudit: RecordAuditMock): TeamMembershipAuditEvent {
  const call = recordAudit.mock.calls.at(0);
  if (call === undefined) {
    throw new TypeError('Expected a membership audit call');
  }
  return call[1];
}

function order(mock: {
  readonly mock: { readonly invocationCallOrder: readonly number[] };
}): number {
  const value = mock.mock.invocationCallOrder.at(0);
  if (value === undefined) {
    throw new TypeError('Expected the call to have happened');
  }
  return value;
}

describe('TeamRepository.leave', () => {
  it('소속이 없으면 not-found를 반환하고 잠그지도 기록하지도 않는다', async () => {
    const { tx, queryRaw, recordAudit } = buildTx(syntheticLeaderId, {
      preLockMembership: null,
    });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('not-found');
    expect(queryRaw).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('팀 행을 FOR UPDATE로 잠근 뒤에 소속을 다시 읽는다', async () => {
    const { tx, queryRaw, findUnique, recordAudit } = buildTx(
      syntheticLeaderId,
      {},
    );

    await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    const call = queryRaw.mock.calls.at(0);
    if (call === undefined) {
      throw new TypeError('Expected the team row to be locked');
    }
    const [sql] = call;
    expect(sql.sql).toContain('FOR UPDATE');
    expect(sql.sql).toContain('"Team"');
    expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      order(queryRaw),
    );
    expect(order(queryRaw)).toBeLessThan(
      findUnique.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('잠근 뒤 소속이 사라진 낡은 행위자는 not-found로 아무것도 바꾸지 않는다', async () => {
    const { tx, teamMemberDelete, teamDelete, teamUpdate, recordAudit } =
      buildTx(syntheticLeaderId, { lockedMembership: null });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('not-found');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('잠근 뒤 소속 팀이 바뀌면 그 팀의 인원·신청을 읽지 않는다', async () => {
    const { tx, count, teamFindUniqueOrThrow, teamMemberDelete, recordAudit } =
      buildTx(syntheticLeaderId, {
        lockedMembership: {
          ...teamContext(syntheticLeaderId),
          teamId: syntheticOtherTeamId,
        },
      });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('not-found');
    expect(count).not.toHaveBeenCalled();
    expect(teamFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('신청 기록이 있는 팀의 마지막 구성원은 나가지 못하고 이력이 남는다', async () => {
    const {
      tx,
      teamMemberDelete,
      teamDelete,
      teamInvitationDeleteMany,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 1,
      status: ApplicationStatus.APPROVED,
    });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('last-member-with-application');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(teamInvitationDeleteMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('승인 전 마지막 구성원의 탈퇴는 대기 초대를 닫고 삭제 이력을 남긴다', async () => {
    const {
      tx,
      teamMemberDelete,
      teamInvitationDeleteMany,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 1,
      status: ApplicationStatus.SUBMITTED,
    });
    tx.teamInvitation.count.mockResolvedValue(1);
    tx.teamInvitation.findMany.mockResolvedValue([
      {
        id: 'synthetic-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticMemberId,
        invitedById: syntheticLeaderId,
        createdAt: new Date('2026-01-01'),
      },
    ]);
    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );
    expect(result).toBe('removed');
    expect(teamMemberDelete).toHaveBeenCalledWith({
      where: {
        teamId_userId: { teamId: syntheticTeamId, userId: syntheticLeaderId },
      },
    });
    expect(teamInvitationDeleteMany).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
    });
    expect(order(teamInvitationDeleteMany)).toBeLessThan(order(teamDelete));
    expect(order(teamMemberDelete)).toBeLessThan(order(teamDelete));
    expect(tx.teamHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: syntheticTeamId,
        actorId: syntheticLeaderId,
        event: 'DELETED',
        data: expect.objectContaining({
          reason: 'LAST_MEMBER_LEFT',
          name: syntheticTeamName,
          deletedCounts: {
            teams: 1,
            members: 1,
            invitations: 1,
            submissions: 0,
            repositories: 0,
          },
        }) as unknown,
      }) as unknown,
    });
    expect(tx.teamHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'INVITATION_CANCELLED',
        sourceId: 'synthetic-invitation',
      }) as unknown,
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('팀장이 나가면 createdAt·id 오름차순 선임자에게 넘긴 뒤 자신을 지운다 대신 명시적 위임을 요구한다', async () => {
    const {
      tx,
      findFirstMember,
      teamUpdate,
      teamMemberDelete,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      status: ApplicationStatus.SUBMITTED,
      successor: { userId: syntheticMemberId },
    });
    expect(
      await buildRepository(tx).leave(
        syntheticProgramId,
        syntheticLeaderId,
        recordAudit,
      ),
    ).toBe('leader-transfer-required');
    expect(findFirstMember).not.toHaveBeenCalled();
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('같은 createdAt 이면 userId 오름차순 정렬이 승계를 결정한다 대신 명시적 위임을 요구한다', async () => {
    const {
      tx,
      findFirstMember,
      teamUpdate,
      teamMemberDelete,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      status: ApplicationStatus.SUBMITTED,
      successor: { userId: syntheticSecondMemberId },
    });
    expect(
      await buildRepository(tx).leave(
        syntheticProgramId,
        syntheticLeaderId,
        recordAudit,
      ),
    ).toBe('leader-transfer-required');
    expect(findFirstMember).not.toHaveBeenCalled();
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('신청 제출 뒤에도 마지막 구성원이 아니면 팀장이 나갈 수 있다 대신 명시적 위임을 요구한다', async () => {
    const {
      tx,
      findFirstMember,
      teamUpdate,
      teamMemberDelete,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      status: ApplicationStatus.APPROVED,
      successor: { userId: syntheticMemberId },
    });
    expect(
      await buildRepository(tx).leave(
        syntheticProgramId,
        syntheticLeaderId,
        recordAudit,
      ),
    ).toBe('leader-transfer-required');
    expect(findFirstMember).not.toHaveBeenCalled();
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('일반 팀원은 팀장을 그대로 두고 자신만 나간다', async () => {
    const { tx, teamUpdate, teamDelete, teamMemberDelete, recordAudit } =
      buildTx(syntheticMemberId, {
        lockedMembership: teamContext(syntheticLeaderId),
        memberCount: 2,
        status: ApplicationStatus.APPROVED,
      });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(teamMemberDelete).toHaveBeenCalledWith({
      where: {
        teamId_userId: { teamId: syntheticTeamId, userId: syntheticMemberId },
      },
    });
    expect(auditEventOf(recordAudit)).toMatchObject({
      operation: 'LEAVE',
      removedUserId: syntheticMemberId,
      previousLeaderId: syntheticLeaderId,
      nextLeaderId: syntheticLeaderId,
    });
  });

  it('감사 기록이 실패하면 트랜잭션 밖으로 예외를 던져 구성원 변경을 중단한다', async () => {
    const failure = new Error('audit write failed');
    const recordAudit = createRecordAuditMock().mockRejectedValue(failure);
    const { tx } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,

      recordAudit,
    });

    await expect(
      buildRepository(tx).leave(
        syntheticProgramId,
        syntheticMemberId,
        recordAudit,
      ),
    ).rejects.toBe(failure);
  });

  it('감사 콜백은 같은 트랜잭션 클라이언트를 writer 로 받는다', async () => {
    const { tx, recordAudit } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,
    });

    await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticMemberId,
      recordAudit,
    );

    expect(recordAudit).toHaveBeenCalledWith(
      { historyWriter: tx, programId: syntheticProgramId },
      expect.objectContaining({ operation: 'LEAVE' }),
    );
  });
});

describe('TeamRepository.removeMember', () => {
  it('행위자가 이 프로그램의 팀원이 아니면 잠그지 않고 actor-not-in-team', async () => {
    const { tx, queryRaw, recordAudit } = buildTx(syntheticLeaderId, {
      preLockMembership: null,
    });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('actor-not-in-team');
    expect(queryRaw).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('잠근 뒤 소속이 사라진 낡은 행위자는 actor-not-in-team', async () => {
    const { tx, teamMemberDelete, recordAudit } = buildTx(syntheticLeaderId, {
      lockedMembership: null,
    });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('actor-not-in-team');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('잠근 뒤 팀장이 아니면 대상 존재를 조회하지 않고 not-leader', async () => {
    const { tx, findUnique, teamMemberDelete, recordAudit } = buildTx(
      syntheticMemberId,
      { lockedMembership: teamContext(syntheticLeaderId), memberCount: 3 },
    );

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticMemberId,
      syntheticSecondMemberId,
      recordAudit,
    );

    expect(result).toBe('not-leader');
    expect(
      findUnique.mock.calls.filter(
        (call) =>
          call[0].where.programId_userId.userId === syntheticSecondMemberId,
      ),
    ).toHaveLength(0);
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('팀장이 자기 자신을 대상으로 하면 self-target 이고 아무도 지우지 않는다', async () => {
    const { tx, teamMemberDelete, recordAudit } = buildTx(syntheticLeaderId, {
      memberCount: 3,
    });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('self-target');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('다른 팀의 구성원은 구분 없는 target-not-found 다', async () => {
    const { tx, teamMemberDelete, recordAudit } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      targetMembership: { teamId: syntheticOtherTeamId },
    });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('target-not-found');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('소속이 아예 없는 사용자도 같은 target-not-found 다', async () => {
    const { tx, teamMemberDelete, recordAudit } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      targetMembership: null,
    });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('target-not-found');
    expect(teamMemberDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('팀장은 다른 현재 구성원을 지우고 팀장 유지 상태로 기록한다', async () => {
    const { tx, teamMemberDelete, teamUpdate, teamDelete, recordAudit } =
      buildTx(syntheticLeaderId, {
        memberCount: 3,
        status: ApplicationStatus.APPROVED,
      });

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(teamMemberDelete).toHaveBeenCalledWith({
      where: {
        teamId_userId: { teamId: syntheticTeamId, userId: syntheticMemberId },
      },
    });
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(teamDelete).not.toHaveBeenCalled();
    expect(order(teamMemberDelete)).toBeLessThan(order(recordAudit));
    expect(auditEventOf(recordAudit)).toEqual({
      teamId: syntheticTeamId,
      programName: syntheticProgramName,
      teamName: syntheticTeamName,
      operation: 'REMOVE',
      removedUserId: syntheticMemberId,
      previousLeaderId: syntheticLeaderId,
      nextLeaderId: syntheticLeaderId,
    });
  });

  it('제외의 감사 기록이 실패하면 예외가 그대로 올라온다', async () => {
    const failure = new Error('audit write failed');
    const recordAudit = createRecordAuditMock().mockRejectedValue(failure);
    const { tx } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      recordAudit,
    });

    await expect(
      buildRepository(tx).removeMember(
        syntheticProgramId,
        syntheticLeaderId,
        syntheticMemberId,
        recordAudit,
      ),
    ).rejects.toBe(failure);
  });
});

describe('TeamRepository 권한 동기화 이벤트 예약', () => {
  const NOW = new Date('2026-09-05T03:04:05.678Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function expectedRow() {
    return new PlatformRepository().repositoryAccessSyncEventData(
      syntheticTeamId,
      NOW,
    );
  }

  it('탈퇴는 승인·NEW·발급 켜진 신청만 골라 한 번 예약한다', async () => {
    const {
      tx,
      teamFindMany,
      outboxCreateMany,
      teamMemberDelete,
      recordAudit,
    } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,
      status: ApplicationStatus.APPROVED,
      accessSyncTeams: [{ id: syntheticTeamId }],
    });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('removed');

    expect(teamFindMany).toHaveBeenCalledWith({
      where: {
        id: syntheticTeamId,
        status: ApplicationStatus.APPROVED,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        program: { repositoryProvisioningEnabled: true },
      },
      select: { id: true },
    });
    expect(outboxCreateMany).toHaveBeenCalledTimes(1);
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: [expectedRow()],
      skipDuplicates: true,
    });

    expect(order(teamMemberDelete)).toBeLessThan(order(outboxCreateMany));
    expect(order(outboxCreateMany)).toBeLessThan(order(recordAudit));
  });

  it('예약하는 payload 는 공유 factory 가 만든 행 그대로다', async () => {
    const { tx, outboxCreateMany, recordAudit } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,
      status: ApplicationStatus.APPROVED,
      accessSyncTeams: [{ id: syntheticTeamId }],
    });

    await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticMemberId,
      recordAudit,
    );

    const [args] = outboxCreateMany.mock.calls.at(0) as [
      { data: readonly Record<string, unknown>[] },
    ];
    const [row] = args.data;
    expect(row).toMatchObject({
      type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
      aggregateType: 'Team',
      aggregateId: syntheticTeamId,
      availableAt: NOW,
      payload: {
        teamId: syntheticTeamId,
        requestedAt: NOW.toISOString(),
      },
    });
  });

  it('제외도 같은 지점에서 한 번 예약한다', async () => {
    const { tx, outboxCreateMany, teamMemberDelete, recordAudit } = buildTx(
      syntheticLeaderId,
      {
        memberCount: 3,
        accessSyncTeams: [{ id: syntheticTeamId }],
      },
    );

    const result = await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: [expectedRow()],
      skipDuplicates: true,
    });
    expect(order(teamMemberDelete)).toBeLessThan(order(outboxCreateMany));
    expect(order(outboxCreateMany)).toBeLessThan(order(recordAudit));
  });

  it.each([
    ['탈퇴', syntheticMemberId],
    ['제외', syntheticLeaderId],
  ] as const)(
    '%s 에 대상 신청이 없으면 outbox 에 아무것도 쓰지 않는다',
    async (label, actorId) => {
      const { tx, teamFindMany, outboxCreateMany, recordAudit } = buildTx(
        actorId,
        {
          lockedMembership: teamContext(syntheticLeaderId),
          memberCount: 3,
          status: ApplicationStatus.APPROVED,
          accessSyncTeams: [],
        },
      );

      const result =
        label === '탈퇴'
          ? await buildRepository(tx).leave(
              syntheticProgramId,
              actorId,
              recordAudit,
            )
          : await buildRepository(tx).removeMember(
              syntheticProgramId,
              actorId,
              syntheticMemberId,
              recordAudit,
            );

      expect(result).toBe('removed');
      expect(teamFindMany).toHaveBeenCalledTimes(1);
      expect(outboxCreateMany).not.toHaveBeenCalled();

      expect(recordAudit).toHaveBeenCalledTimes(1);
    },
  );

  it('신청 없는 1인 팀이 통째로 사라질 때는 조회도 예약도 하지 않는다', async () => {
    const { tx, teamFindMany, outboxCreateMany, teamDelete, recordAudit } =
      buildTx(syntheticLeaderId, {
        memberCount: 1,
        status: ApplicationStatus.SUBMITTED,
      });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(teamDelete).toHaveBeenCalled();
    expect(teamFindMany).not.toHaveBeenCalled();
    expect(outboxCreateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      '소속이 없는 탈퇴',
      { preLockMembership: null },
      syntheticLeaderId,
      'leave' as const,
    ],
    [
      '신청이 있는 마지막 구성원 탈퇴',
      {
        memberCount: 1,
        status: ApplicationStatus.APPROVED,
        accessSyncTeams: [{ id: syntheticTeamId }],
      },
      syntheticLeaderId,
      'leave' as const,
    ],
    [
      '팀장이 아닌 행위자의 제외',
      {
        lockedMembership: teamContext(syntheticLeaderId),
        memberCount: 3,
        accessSyncTeams: [{ id: syntheticTeamId }],
      },
      syntheticMemberId,
      'removeMember' as const,
    ],
    [
      '다른 팀 대상 제외',
      {
        memberCount: 3,
        targetMembership: { teamId: syntheticOtherTeamId },
        accessSyncTeams: [{ id: syntheticTeamId }],
      },
      syntheticLeaderId,
      'removeMember' as const,
    ],
  ])(
    '%s 처럼 구성원이 바뀌지 않은 결과는 이벤트를 남기지 않는다',
    async (_label, options, actorId, operation) => {
      const { tx, outboxCreateMany, teamMemberDelete, recordAudit } = buildTx(
        actorId,
        options,
      );

      if (operation === 'leave') {
        await buildRepository(tx).leave(
          syntheticProgramId,
          actorId,
          recordAudit,
        );
      } else {
        await buildRepository(tx).removeMember(
          syntheticProgramId,
          actorId,
          syntheticSecondMemberId,
          recordAudit,
        );
      }

      expect(teamMemberDelete).not.toHaveBeenCalled();
      expect(outboxCreateMany).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it('감사 기록이 실패하면 예약된 이벤트까지 같은 트랜잭션에서 되돌린다', async () => {
    const failure = new Error('audit write failed');
    const recordAudit = createRecordAuditMock().mockRejectedValue(failure);
    const { tx, outboxCreateMany } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      accessSyncTeams: [{ id: syntheticTeamId }],
      recordAudit,
    });

    await expect(
      buildRepository(tx).removeMember(
        syntheticProgramId,
        syntheticLeaderId,
        syntheticMemberId,
        recordAudit,
      ),
    ).rejects.toBe(failure);

    expect(outboxCreateMany).toHaveBeenCalledTimes(1);
  });

  it('구성원 트랜잭션은 provision job 이나 GitHub 표면을 전혀 들고 있지 않다', async () => {
    const { tx, recordAudit } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      accessSyncTeams: [{ id: syntheticTeamId }],
    });

    await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    expect(tx.repositoryProvisionJob.deleteMany).not.toHaveBeenCalled();
    expect(tx.githubRepository.count).not.toHaveBeenCalled();
  });
});
