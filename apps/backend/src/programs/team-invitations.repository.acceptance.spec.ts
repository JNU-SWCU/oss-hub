import { TeamHistoryRepository } from './team-history.repository';
import { PlatformRepository } from '../platform/platform.repository';
import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  RepositoryConnectionMode,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { PrismaService } from '../platform/prisma.service';
import {
  type AcceptInvitationOnOk,
  TeamInvitationsRepository,
} from './team-invitations.repository';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../platform/repository-access-sync.config';

const syntheticProgramId = 'cuid-synthetic-program';
const syntheticTeamId = 'cuid-synthetic-team';
const syntheticInviteeId = 'cuid-synthetic-invitee';
const syntheticInvitationId = 'cuid-invitation';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticTeamName = '합성 팀';
const syntheticProgramName = '합성 프로그램';
const acceptedAt = new Date('2026-08-02T00:00:00.000Z');

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('conflict', {
    code,
    clientVersion: 'test',
    meta: { modelName: 'TeamMember' },
  });
}

describe('TeamInvitationsRepository.withAcceptTransaction', () => {
  const invitationRow = {
    id: syntheticInvitationId,
    teamId: syntheticTeamId,
    programId: syntheticProgramId,
    inviteeId: syntheticInviteeId,
    invitedById: 'synthetic-inviter',
    createdAt: new Date('2026-08-01'),
    team: {
      name: syntheticTeamName,
      program: { teamMaxSize: 4, name: syntheticProgramName },
    },
  };

  interface TxOptions {
    readonly invitation?: typeof invitationRow | null;

    readonly lockedInvitation?: { readonly id: string } | null;
    readonly invitee?: {
      readonly id: string;
      readonly accountStatus: AccountStatus;
      readonly type: MemberKind | 'UNSELECTED';
    } | null;
    readonly membership?: { readonly userId: string } | null;
    readonly memberCount?: number;
    readonly acceptedCount?: number;
    readonly create?: jest.Mock;

    readonly approvedNewApplications?: readonly { readonly id: string }[];
    readonly createManyOutbox?: jest.Mock;
  }

  function buildTx(options: TxOptions = {}) {
    const invitation =
      options.invitation === undefined ? invitationRow : options.invitation;
    const lockedInvitation =
      options.lockedInvitation === undefined
        ? { id: syntheticInvitationId }
        : options.lockedInvitation;
    let invitationReads = 0;
    const findUnique = jest.fn(() => {
      invitationReads += 1;
      return Promise.resolve(
        invitationReads === 1 ? invitation : lockedInvitation,
      );
    });
    return {
      teamInvitation: {
        findUnique,
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest
          .fn()
          .mockResolvedValueOnce({ count: options.acceptedCount ?? 1 })
          .mockResolvedValue({ count: 0 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(options.membership ?? null),
        count: jest.fn().mockResolvedValue(options.memberCount ?? 1),
        create: options.create ?? jest.fn().mockResolvedValue(undefined),
      },
      teamHistory: { create: jest.fn().mockResolvedValue({}) },
      user: {
        findUnique: jest.fn().mockResolvedValue(
          options.invitee === undefined
            ? {
                id: syntheticInviteeId,
                accountStatus: AccountStatus.ACTIVE,
                type: MemberKind.STUDENT,
              }
            : options.invitee,
        ),
      },
      team: { update: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValue([...(options.approvedNewApplications ?? [])]),
      },
      outboxEvent: {
        createMany:
          options.createManyOutbox ?? jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
    };
  }

  function buildRepository(tx: object) {
    return new TeamInvitationsRepository(
      new TeamHistoryRepository(),
      {
        $transaction: <T>(operation: (transaction: never) => Promise<T>) =>
          operation(tx as never),
      } as unknown as PrismaService,
      new PlatformRepository(),
    );
  }

  function accept(
    tx: object,
    inviteeId: string = syntheticInviteeId,
    onOk?: AcceptInvitationOnOk,
  ) {
    return buildRepository(tx).withAcceptTransaction(
      syntheticInvitationId,
      inviteeId,
      acceptedAt,
      onOk,
    );
  }

  it('초대가 없으면 팀을 잠그기 전에 not-found를 반환한다', async () => {
    const tx = buildTx({ invitation: null });

    await expect(accept(tx)).resolves.toEqual({ kind: 'not-found' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('초대받은 사람이 아니면 잠그기 전에 forbidden을 반환한다', async () => {
    const tx = buildTx();

    await expect(accept(tx, 'cuid-someone-else')).resolves.toEqual({
      kind: 'forbidden',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('Program → Team → User 순서로 잠근 뒤 초대 행을 원자적으로 삭제한다', async () => {
    const tx = buildTx();

    const outcome = await accept(tx);

    const lockCalls = tx.$queryRaw.mock.calls as [Prisma.Sql][];
    expect(lockCalls).toHaveLength(3);
    expect(lockCalls[0]?.[0].sql).toContain('"Program"');
    expect(lockCalls[0]?.[0].values).toEqual([syntheticProgramId]);
    expect(lockCalls[1]![0].sql).toContain('"Team"');
    expect(lockCalls[1]![0].sql).toContain('FOR UPDATE');
    expect(lockCalls[1]![0].values).toEqual([syntheticTeamId]);
    expect(lockCalls[2]![0].sql).toContain('"User"');
    expect(lockCalls[2]![0].values).toEqual([syntheticInviteeId]);
    expect(tx.teamInvitation.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: syntheticInvitationId },
      select: { id: true },
    });
    expect(tx.teamInvitation.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: syntheticInvitationId },
    });
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('만들어지는 TeamMember에 팀장 표식이 없고 Team.leaderId도 건드리지 않는다', async () => {
    const tx = buildTx();

    await accept(tx);

    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: {
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        userId: syntheticInviteeId,
      },
    });
    const [createArgs] = tx.teamMember.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(Object.keys(createArgs.data).sort()).toEqual([
      'programId',
      'teamId',
      'userId',
    ]);
    expect(tx.team.update).not.toHaveBeenCalled();
  });

  it('합류 뒤 같은 프로그램의 남은 PENDING 초대만 조회한다', async () => {
    const tx = buildTx();

    await accept(tx);

    expect(tx.teamInvitation.findMany).toHaveBeenCalledWith({
      where: {
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        id: { not: syntheticInvitationId },
      },
      orderBy: { id: 'asc' },
    });
    const [terminalize] = tx.teamInvitation.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(terminalize.where.programId).toBe(syntheticProgramId);
  });

  it('성공 지점에서만 TEAM_JOINED 감사 기록 훅을 같은 트랜잭션으로 부른다', async () => {
    const tx = buildTx();
    const onOk = jest.fn().mockResolvedValue(undefined);

    await accept(tx, syntheticInviteeId, onOk);

    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith(
      { auditLogWriter: tx },
      {
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        teamName: syntheticTeamName,
        programName: syntheticProgramName,
      },
    );
  });

  it('승인된 NEW 신청이 있으면 같은 트랜잭션에서 권한 동기화 이벤트를 예약한다', async () => {
    const tx = buildTx({
      approvedNewApplications: [{ id: syntheticApplicationId }],
    });
    const onOk = jest.fn().mockResolvedValue(undefined);

    await expect(accept(tx, syntheticInviteeId, onOk)).resolves.toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });

    expect(tx.team.findMany).toHaveBeenCalledWith({
      where: {
        id: syntheticTeamId,
        status: ApplicationStatus.APPROVED,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        program: { repositoryProvisioningEnabled: true },
      },
      select: { id: true },
    });
    const requestedAt = acceptedAt.toISOString();
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
          aggregateType: 'Team',
          aggregateId: syntheticApplicationId,
          idempotencyKey: `repository-access-sync:${syntheticApplicationId}:${requestedAt}`,
          payload: {
            teamId: syntheticApplicationId,
            requestedAt,
          },
          availableAt: acceptedAt,
        },
      ],
      skipDuplicates: true,
    });

    expect(onOk).toHaveBeenCalledWith(
      { auditLogWriter: tx },
      expect.objectContaining({ teamId: syntheticTeamId }),
    );
  });

  it('승인된 NEW 신청이 없으면 조회만 하고 outbox에 아무것도 쓰지 않는다', async () => {
    const tx = buildTx();

    await expect(accept(tx)).resolves.toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
    expect(tx.team.findMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('수락이 실패하면 권한 동기화 대상을 조회하지도 않는다', async () => {
    const tx = buildTx({ memberCount: 4 });

    await expect(accept(tx)).resolves.toEqual({ kind: 'team-full' });
    expect(tx.team.findMany).not.toHaveBeenCalled();
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('outbox 예약이 실패하면 감사 기록 없이 트랜잭션 밖으로 전파한다', async () => {
    const boom = new Error('outbox write failed');
    const tx = buildTx({
      approvedNewApplications: [{ id: syntheticApplicationId }],
      createManyOutbox: jest.fn().mockRejectedValue(boom),
    });
    const onOk = jest.fn().mockResolvedValue(undefined);

    await expect(accept(tx, syntheticInviteeId, onOk)).rejects.toBe(boom);

    expect(tx.teamMember.create).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('실패한 수락에서는 감사 기록 훅을 부르지 않는다', async () => {
    const tx = buildTx({ memberCount: 4 });
    const onOk = jest.fn();

    await expect(accept(tx, syntheticInviteeId, onOk)).resolves.toEqual({
      kind: 'team-full',
    });
    expect(onOk).not.toHaveBeenCalled();
  });

  it('잠금 뒤 초대 행이 사라졌으면 not-found를 반환한다', async () => {
    const tx = buildTx({ lockedInvitation: null });

    await expect(accept(tx)).resolves.toEqual({ kind: 'not-found' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('deleteMany count가 0이면 not-found을 반환하고 멤버를 만들지 않는다', async () => {
    const tx = buildTx({ acceptedCount: 0 });

    const outcome = await accept(tx);

    expect(outcome).toEqual({ kind: 'not-found' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('학생이 아니면 invitee-not-eligible을 반환한다', async () => {
    const tx = buildTx({
      invitee: {
        id: syntheticInviteeId,
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STAFF,
      },
    });

    await expect(accept(tx)).resolves.toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('비활성 계정이면 invitee-not-eligible을 반환한다', async () => {
    const tx = buildTx({
      invitee: {
        id: syntheticInviteeId,
        accountStatus: AccountStatus.DEACTIVATED,
        type: MemberKind.STUDENT,
      },
    });

    await expect(accept(tx)).resolves.toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamInvitation.deleteMany).not.toHaveBeenCalled();
  });

  it('이미 같은 프로그램 팀에 소속돼 있으면 already-in-team을 반환한다', async () => {
    const tx = buildTx({ membership: { userId: syntheticInviteeId } });

    const outcome = await accept(tx);

    expect(tx.teamMember.findUnique).toHaveBeenCalledWith({
      where: {
        programId_userId: {
          programId: syntheticProgramId,
          userId: syntheticInviteeId,
        },
      },
      select: { userId: true },
    });
    expect(outcome).toEqual({ kind: 'already-in-team' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('정원이 이미 찼으면 team-full을 반환한다', async () => {
    const tx = buildTx({ memberCount: 4 });

    const outcome = await accept(tx);

    expect(tx.teamMember.count).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
    });
    expect(outcome).toEqual({ kind: 'team-full' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('정원 직전 인원이면 수락한다', async () => {
    const tx = buildTx({ memberCount: 3 });

    await expect(accept(tx)).resolves.toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('teamMember.create가 P2002로 실패하면 already-in-team으로 흡수한다(경합)', async () => {
    const tx = buildTx({
      create: jest.fn().mockRejectedValue(knownRequestError('P2002')),
    });

    await expect(accept(tx)).resolves.toEqual({ kind: 'already-in-team' });
  });

  it('다른 Prisma 에러는 그대로 전파한다', async () => {
    const boom = knownRequestError('P2003');
    const tx = buildTx({ create: jest.fn().mockRejectedValue(boom) });

    await expect(accept(tx)).rejects.toBe(boom);
  });

  it('이력의 유니크 충돌을 이미 가입된 사용자로 잘못 보고하지 않는다', async () => {
    const boom = new Prisma.PrismaClientKnownRequestError('history conflict', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'TeamHistory' },
    });
    const tx = buildTx();
    tx.teamHistory.create.mockRejectedValueOnce(boom);
    await expect(accept(tx)).rejects.toBe(boom);
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });
});
