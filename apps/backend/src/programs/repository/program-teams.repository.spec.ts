import {
  ApplicationStatus,
  Prisma,
  RepositoryConnectionMode,
} from '@prisma/client';
import {
  REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
  repositoryAccessSyncEventData,
} from '../../github/repository-provision-event';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ProgramTeamsRepository,
  type RecordTeamMembershipAudit,
  type TeamMembershipAuditEvent,
} from './program-teams.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
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
  return new ProgramTeamsRepository(prisma as unknown as PrismaService);
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

/** repository 가 불러야 하는 감사 콜백 계약 그대로의 mock. */
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
  /** 잠금 전 스냅샷. `undefined` 면 행위자가 합성 팀에 소속된 상태. */
  readonly preLockMembership?: MembershipRow;
  /** 잠근 뒤 재조회 값. `undefined` 면 팀장이 행위자인 합성 팀. */
  readonly lockedMembership?: ReturnType<typeof teamContext> | null;
  readonly targetMembership?: MembershipRow;
  readonly memberCount?: number;
  readonly application?: { readonly id: string } | null;
  readonly successor?: { readonly userId: string } | null;
  /**
   * 권한 동기화 대상 신청(APPROVED + NEW + 발급 켬 프로그램). 기본은 없음.
   * 조건은 `findMany` where 절이 걸러내므로 fake 는 결과만 돌려준다.
   */
  readonly accessSyncApplications?: readonly { readonly id: string }[];
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
  const applicationFindFirst = jest
    .fn()
    .mockResolvedValue(options.application ?? null);
  const applicationFindMany = jest
    .fn()
    .mockResolvedValue(options.accessSyncApplications ?? []);
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
    teamInvitation: { deleteMany: teamInvitationDeleteMany },
    team: { update: teamUpdate, delete: teamDelete },
    application: {
      findFirst: applicationFindFirst,
      findMany: applicationFindMany,
    },
    outboxEvent: { createMany: outboxCreateMany },
    $queryRaw: queryRaw,
  };

  return {
    tx,
    queryRaw,
    findUnique,
    findFirstMember,
    count,
    applicationFindFirst,
    applicationFindMany,
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

describe('ProgramTeamsRepository.leave', () => {
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
    const { tx, count, applicationFindFirst, teamMemberDelete, recordAudit } =
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
    expect(applicationFindFirst).not.toHaveBeenCalled();
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
      application: { id: 'cuid-application' },
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

  it('미제출 1인 팀장은 대기 초대를 팀보다 먼저 지우고 nextLeaderId 없이 기록한다', async () => {
    const {
      tx,
      teamMemberDelete,
      teamInvitationDeleteMany,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, { memberCount: 1, application: null });

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
      where: { teamId: syntheticTeamId, programId: syntheticProgramId },
    });
    expect(order(teamMemberDelete)).toBeLessThan(
      order(teamInvitationDeleteMany),
    );
    expect(order(teamInvitationDeleteMany)).toBeLessThan(order(teamDelete));
    expect(order(teamDelete)).toBeLessThan(order(recordAudit));
    expect(auditEventOf(recordAudit)).toEqual({
      teamId: syntheticTeamId,
      programName: syntheticProgramName,
      teamName: syntheticTeamName,
      operation: 'LEAVE',
      removedUserId: syntheticLeaderId,
      previousLeaderId: syntheticLeaderId,
      nextLeaderId: null,
    });
  });

  it('팀장이 나가면 createdAt·id 오름차순 선임자에게 넘긴 뒤 자신을 지운다', async () => {
    const {
      tx,
      findFirstMember,
      teamUpdate,
      teamMemberDelete,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      successor: { userId: syntheticMemberId },
    });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(findFirstMember).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId, userId: { not: syntheticLeaderId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    });
    expect(teamUpdate).toHaveBeenCalledWith({
      where: { id: syntheticTeamId },
      data: { leaderId: syntheticMemberId },
    });
    expect(order(teamUpdate)).toBeLessThan(order(teamMemberDelete));
    expect(teamDelete).not.toHaveBeenCalled();
    expect(auditEventOf(recordAudit)).toMatchObject({
      operation: 'LEAVE',
      removedUserId: syntheticLeaderId,
      previousLeaderId: syntheticLeaderId,
      nextLeaderId: syntheticMemberId,
    });
  });

  it('같은 createdAt 이면 id 오름차순 정렬이 승계를 결정한다', async () => {
    const { tx, findFirstMember, teamUpdate, recordAudit } = buildTx(
      syntheticLeaderId,
      {
        memberCount: 3,
        successor: { userId: syntheticSecondMemberId },
      },
    );

    await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    const [args] = findFirstMember.mock.calls.at(0) as [
      { orderBy: readonly unknown[] },
    ];
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(teamUpdate).toHaveBeenCalledWith({
      where: { id: syntheticTeamId },
      data: { leaderId: syntheticSecondMemberId },
    });
  });

  it('신청 제출 뒤에도 마지막 구성원이 아니면 팀장이 나갈 수 있다', async () => {
    const { tx, teamUpdate, teamMemberDelete, recordAudit } = buildTx(
      syntheticLeaderId,
      {
        memberCount: 2,
        application: { id: 'cuid-application' },
        successor: { userId: syntheticMemberId },
      },
    );

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(teamUpdate).toHaveBeenCalled();
    expect(teamMemberDelete).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it('일반 팀원은 팀장을 그대로 두고 자신만 나간다', async () => {
    const { tx, teamUpdate, teamDelete, teamMemberDelete, recordAudit } =
      buildTx(syntheticMemberId, {
        lockedMembership: teamContext(syntheticLeaderId),
        memberCount: 2,
        application: { id: 'cuid-application' },
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

  it('감사 기록이 실패하면 트랜잭션 밖으로 예외를 던져 승계까지 되돌린다', async () => {
    const failure = new Error('audit write failed');
    const recordAudit = createRecordAuditMock().mockRejectedValue(failure);
    const { tx } = buildTx(syntheticLeaderId, {
      memberCount: 2,
      successor: { userId: syntheticMemberId },
      recordAudit,
    });

    await expect(
      buildRepository(tx).leave(
        syntheticProgramId,
        syntheticLeaderId,
        recordAudit,
      ),
    ).rejects.toBe(failure);
  });

  it('감사 콜백은 같은 트랜잭션 클라이언트를 writer 로 받는다', async () => {
    const { tx, recordAudit } = buildTx(syntheticLeaderId, {});

    await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(recordAudit).toHaveBeenCalledWith(
      { auditLogWriter: tx },
      expect.objectContaining({ operation: 'LEAVE' }),
    );
  });
});

describe('ProgramTeamsRepository.removeMember', () => {
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
        application: { id: 'cuid-application' },
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

/**
 * 구성원이 실제로 빠졌을 때만, 그리고 같은 트랜잭션에서 outbox 행만 남긴다.
 * GitHub 호출·provision job 잠금은 worker 몫이라 이 트랜잭션에서는 일어나지 않는다.
 */
describe('ProgramTeamsRepository 권한 동기화 이벤트 예약', () => {
  const syntheticApplicationId = 'cuid-synthetic-application';
  const NOW = new Date('2026-09-05T03:04:05.678Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function expectedRow() {
    return repositoryAccessSyncEventData(
      syntheticApplicationId,
      syntheticTeamId,
      NOW,
    );
  }

  it('탈퇴는 승인·NEW·발급 켜진 신청만 골라 한 번 예약한다', async () => {
    const {
      tx,
      applicationFindMany,
      outboxCreateMany,
      teamMemberDelete,
      recordAudit,
    } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,
      application: { id: syntheticApplicationId },
      accessSyncApplications: [{ id: syntheticApplicationId }],
    });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticMemberId,
      recordAudit,
    );

    expect(result).toBe('removed');
    // 조건은 where 절이 지고 id 외에는 아무것도 읽지 않는다.
    expect(applicationFindMany).toHaveBeenCalledWith({
      where: {
        teamId: syntheticTeamId,
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
    // 구성원이 지워진 다음, 감사 기록과 같은 트랜잭션 안이다.
    expect(order(teamMemberDelete)).toBeLessThan(order(outboxCreateMany));
    expect(order(outboxCreateMany)).toBeLessThan(order(recordAudit));
  });

  it('예약하는 payload 는 공유 factory 가 만든 행 그대로다', async () => {
    const { tx, outboxCreateMany, recordAudit } = buildTx(syntheticMemberId, {
      lockedMembership: teamContext(syntheticLeaderId),
      memberCount: 2,
      application: { id: syntheticApplicationId },
      accessSyncApplications: [{ id: syntheticApplicationId }],
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
      aggregateType: 'Application',
      aggregateId: syntheticApplicationId,
      availableAt: NOW,
      payload: {
        applicationId: syntheticApplicationId,
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
        accessSyncApplications: [{ id: syntheticApplicationId }],
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
      const { tx, applicationFindMany, outboxCreateMany, recordAudit } =
        buildTx(actorId, {
          lockedMembership: teamContext(syntheticLeaderId),
          memberCount: 3,
          application: { id: syntheticApplicationId },
          accessSyncApplications: [],
        });

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
      expect(applicationFindMany).toHaveBeenCalledTimes(1);
      expect(outboxCreateMany).not.toHaveBeenCalled();
      // 감사 기록은 그대로 남는다 — 이벤트가 없다고 구성원 변경을 되돌리지 않는다.
      expect(recordAudit).toHaveBeenCalledTimes(1);
    },
  );

  it('신청 없는 1인 팀이 통째로 사라질 때는 조회도 예약도 하지 않는다', async () => {
    const {
      tx,
      applicationFindMany,
      outboxCreateMany,
      teamDelete,
      recordAudit,
    } = buildTx(syntheticLeaderId, { memberCount: 1, application: null });

    const result = await buildRepository(tx).leave(
      syntheticProgramId,
      syntheticLeaderId,
      recordAudit,
    );

    expect(result).toBe('removed');
    expect(teamDelete).toHaveBeenCalled();
    expect(applicationFindMany).not.toHaveBeenCalled();
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
        application: { id: syntheticApplicationId },
        accessSyncApplications: [{ id: syntheticApplicationId }],
      },
      syntheticLeaderId,
      'leave' as const,
    ],
    [
      '팀장이 아닌 행위자의 제외',
      {
        lockedMembership: teamContext(syntheticLeaderId),
        memberCount: 3,
        accessSyncApplications: [{ id: syntheticApplicationId }],
      },
      syntheticMemberId,
      'removeMember' as const,
    ],
    [
      '다른 팀 대상 제외',
      {
        memberCount: 3,
        targetMembership: { teamId: syntheticOtherTeamId },
        accessSyncApplications: [{ id: syntheticApplicationId }],
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
      accessSyncApplications: [{ id: syntheticApplicationId }],
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
    // 쓰기는 이미 불렸지만 같은 트랜잭션이므로 예외와 함께 무효화된다.
    expect(outboxCreateMany).toHaveBeenCalledTimes(1);
  });

  it('구성원 트랜잭션은 provision job 이나 GitHub 표면을 전혀 들고 있지 않다', async () => {
    const { tx, recordAudit } = buildTx(syntheticLeaderId, {
      memberCount: 3,
      accessSyncApplications: [{ id: syntheticApplicationId }],
    });

    await buildRepository(tx).removeMember(
      syntheticProgramId,
      syntheticLeaderId,
      syntheticMemberId,
      recordAudit,
    );

    // fake tx 에 없는 표면을 불렀다면 위 호출이 TypeError 로 터졌을 것이다.
    expect(Object.keys(tx).sort()).toEqual([
      '$queryRaw',
      'application',
      'outboxEvent',
      'team',
      'teamInvitation',
      'teamMember',
    ]);
  });
});
