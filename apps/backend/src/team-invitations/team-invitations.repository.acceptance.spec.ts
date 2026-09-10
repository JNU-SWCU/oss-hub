import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  Prisma,
  RepositoryConnectionMode,
} from '@prisma/client';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../github/repository-provision-event';
import { PrismaService } from '../prisma/prisma.service';
import type { AcceptInvitationOnOk } from './team-invitations.repository';
import { TeamInvitationsRepository } from './team-invitations.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
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
  });
}

describe('TeamInvitationsRepository.withAcceptTransaction', () => {
  const invitationRow = {
    id: syntheticInvitationId,
    teamId: syntheticTeamId,
    programId: syntheticProgramId,
    inviteeId: syntheticInviteeId,
    team: {
      name: syntheticTeamName,
      program: { teamMaxSize: 4, name: syntheticProgramName },
    },
  };

  interface TxOptions {
    readonly invitation?: typeof invitationRow | null;
    /** 팀 행을 잠근 뒤 다시 읽은 상태. */
    readonly lockedStatus?: { readonly status: string } | null;
    readonly invitee?: {
      readonly id: string;
      readonly accountStatus: AccountStatus;
      readonly profile: { readonly memberKind: MemberKind } | null;
    } | null;
    readonly membership?: { readonly userId: string } | null;
    readonly memberCount?: number;
    readonly acceptedCount?: number;
    readonly create?: jest.Mock;
    /**
     * 팀의 「승인 + NEW + 발급 켜짐」 신청 목록. 기본은 빈 배열이다 —
     * 조회 자체는 항상 일어나고, 대상이 없을 때만 outbox 쓰기가 없다.
     */
    readonly approvedNewApplications?: readonly { readonly id: string }[];
    readonly createManyOutbox?: jest.Mock;
  }

  function buildTx(options: TxOptions = {}) {
    const invitation =
      options.invitation === undefined ? invitationRow : options.invitation;
    const lockedStatus =
      options.lockedStatus === undefined
        ? { status: 'PENDING' }
        : options.lockedStatus;
    let invitationReads = 0;
    const findUnique = jest.fn(() => {
      invitationReads += 1;
      return Promise.resolve(invitationReads === 1 ? invitation : lockedStatus);
    });
    return {
      teamInvitation: {
        findUnique,
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: options.acceptedCount ?? 1 })
          .mockResolvedValue({ count: 0 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(options.membership ?? null),
        count: jest.fn().mockResolvedValue(options.memberCount ?? 1),
        create: options.create ?? jest.fn().mockResolvedValue(undefined),
      },
      team: { update: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue(
          options.invitee === undefined
            ? {
                id: syntheticInviteeId,
                accountStatus: AccountStatus.ACTIVE,
                profile: { memberKind: MemberKind.STUDENT },
              }
            : options.invitee,
        ),
      },
      application: {
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
    return new TeamInvitationsRepository({
      $transaction: <T>(operation: (transaction: never) => Promise<T>) =>
        operation(tx as never),
    } as unknown as PrismaService);
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

  it('Team → User 순서로 잠근 뒤 status=PENDING 조건으로 원자 전이한다', async () => {
    const tx = buildTx();

    const outcome = await accept(tx);

    const lockCalls = tx.$queryRaw.mock.calls as [Prisma.Sql][];
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls[0]![0].sql).toContain('"Team"');
    expect(lockCalls[0]![0].sql).toContain('FOR UPDATE');
    expect(lockCalls[0]![0].values).toEqual([syntheticTeamId]);
    expect(lockCalls[1]![0].sql).toContain('"User"');
    expect(lockCalls[1]![0].values).toEqual([syntheticInviteeId]);
    expect(tx.teamInvitation.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: syntheticInvitationId },
      select: { status: true },
    });
    expect(tx.teamInvitation.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: syntheticInvitationId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: acceptedAt },
    });
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  /** 합류는 언제나 일반 구성원이다 — 이 트랜잭션은 팀장을 바꾸지 않는다. */
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

  /**
   * 같은 프로그램의 남은 대기 초대만 종결한다 — 다른 프로그램의 PENDING 초대는
   * `programId` 범위 밖이라 그대로 남는다.
   */
  it('합류 뒤 같은 프로그램의 남은 PENDING 초대만 DECLINED로 종결한다', async () => {
    const tx = buildTx();

    await accept(tx);

    expect(tx.teamInvitation.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        status: 'PENDING',
        id: { not: syntheticInvitationId },
      },
      data: { status: 'DECLINED', respondedAt: acceptedAt },
    });
    const [terminalize] = tx.teamInvitation.updateMany.mock.calls[1] as [
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

    expect(tx.application.findMany).toHaveBeenCalledWith({
      where: {
        teamId: syntheticTeamId,
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
          aggregateType: 'Application',
          aggregateId: syntheticApplicationId,
          idempotencyKey: `repository-access-sync:${syntheticApplicationId}:${requestedAt}`,
          payload: {
            applicationId: syntheticApplicationId,
            teamId: syntheticTeamId,
            requestedAt,
          },
          availableAt: acceptedAt,
        },
      ],
      skipDuplicates: true,
    });
    // 멤버 생성·감사 기록과 같은 트랜잭션 객체로만 쓴다 — 밖에서 다시 쓰지 않는다.
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
    expect(tx.application.findMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('수락이 실패하면 권한 동기화 대상을 조회하지도 않는다', async () => {
    const tx = buildTx({ memberCount: 4 });

    await expect(accept(tx)).resolves.toEqual({ kind: 'team-full' });
    expect(tx.application.findMany).not.toHaveBeenCalled();
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
    // 롤백 경계: 멤버 생성은 이미 호출됐지만 감사 기록은 남지 않는다.
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

  it('팀 잠금 뒤 초대 상태를 다시 읽어 이미 응답된 초대를 거부한다', async () => {
    const tx = buildTx({ lockedStatus: { status: 'ACCEPTED' } });

    const outcome = await accept(tx);

    expect(outcome).toEqual({ kind: 'not-pending' });
    expect(tx.teamInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('잠금 뒤 초대 행이 사라졌으면 not-found를 반환한다', async () => {
    const tx = buildTx({ lockedStatus: null });

    await expect(accept(tx)).resolves.toEqual({ kind: 'not-found' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('updateMany count가 0이면 not-pending을 반환하고 멤버를 만들지 않는다', async () => {
    const tx = buildTx({ acceptedCount: 0 });

    const outcome = await accept(tx);

    expect(outcome).toEqual({ kind: 'not-pending' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('학생이 아니면 invitee-not-eligible을 반환한다', async () => {
    const tx = buildTx({
      invitee: {
        id: syntheticInviteeId,
        accountStatus: AccountStatus.ACTIVE,
        profile: { memberKind: MemberKind.STAFF },
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
        profile: { memberKind: MemberKind.STUDENT },
      },
    });

    await expect(accept(tx)).resolves.toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamInvitation.updateMany).not.toHaveBeenCalled();
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
});
