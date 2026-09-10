import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  RepositoryConnectionMode,
  TeamInvitationStatus,
} from '@prisma/client';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../github/repository-provision-event';
import { TEAM_JOINED_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';
import { acceptTeamInvitationTransaction } from './team-invitation-acceptance.repository';
import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import {
  buildService,
  syntheticGithubId,
  syntheticLeaderId,
  syntheticProgramId,
  syntheticTeamId,
  syntheticUserId,
} from './team-invitations.service.test-support';

const INVITATION_ID = 'cuid-invitation';
const syntheticSuccessorLeaderId = 'cuid-synthetic-successor-leader';
const syntheticApplicationId = 'cuid-synthetic-application';

describe('TeamInvitationsService.cancel', () => {
  function cancelService(kind: string, actorId = syntheticLeaderId) {
    const cancelPendingInvitationAsLeader = jest
      .fn()
      .mockResolvedValue({ kind });
    return {
      ...buildService({
        findUserIdByGithubId: jest.fn().mockResolvedValue(actorId),
        cancelPendingInvitationAsLeader,
      }),
      cancelPendingInvitationAsLeader,
    };
  }

  it('현재 팀장 기준으로 판정하도록 취소 요청자를 그대로 넘긴다', async () => {
    const { service, cancelPendingInvitationAsLeader } = cancelService('ok');

    await service.cancel(syntheticGithubId, INVITATION_ID);

    expect(cancelPendingInvitationAsLeader).toHaveBeenCalledWith(
      INVITATION_ID,
      syntheticLeaderId,
    );
  });

  it('승계받은 팀장은 전 팀장이 보낸 대기 초대도 취소할 수 있다', async () => {
    const { service, cancelPendingInvitationAsLeader } = cancelService(
      'ok',
      syntheticSuccessorLeaderId,
    );

    await expect(
      service.cancel(syntheticGithubId, INVITATION_ID),
    ).resolves.toBeUndefined();
    expect(cancelPendingInvitationAsLeader).toHaveBeenCalledWith(
      INVITATION_ID,
      syntheticSuccessorLeaderId,
    );
  });

  it('팀을 떠난 전 팀장은 자기가 보낸 초대라도 TIV_003으로 거부된다', async () => {
    const { service } = cancelService('not-team-leader', syntheticLeaderId);

    await expect(
      service.cancel(syntheticGithubId, INVITATION_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
  });

  it.each([
    ['not-found', TeamInvitationErrorCode.INVITATION_NOT_FOUND],
    ['not-pending', TeamInvitationErrorCode.INVITATION_NOT_PENDING],
  ] as const)('취소 outcome %s는 %s로 매핑된다', async (kind, expectedCode) => {
    const { service } = cancelService(kind);

    await expect(
      service.cancel(syntheticGithubId, INVITATION_ID),
    ).rejects.toMatchObject({ errorCode: { code: expectedCode } });
  });
});

describe('TeamInvitationsService.decline', () => {
  function declineService(kind: string) {
    const declinePendingInvitationAsInvitee = jest
      .fn()
      .mockResolvedValue({ kind });
    return {
      ...buildService({ declinePendingInvitationAsInvitee }),
      declinePendingInvitationAsInvitee,
    };
  }

  it('초대받은 본인 조건까지 repository에 넘겨 거절한다', async () => {
    const { service, declinePendingInvitationAsInvitee } = declineService('ok');

    await service.decline(syntheticGithubId, INVITATION_ID);

    expect(declinePendingInvitationAsInvitee).toHaveBeenCalledWith(
      INVITATION_ID,
      syntheticUserId,
    );
  });

  it('본인이 받은 초대가 아니면 존재를 알리지 않고 TIV_010으로 거부한다', async () => {
    const { service } = declineService('not-found');

    await expect(
      service.decline(syntheticGithubId, INVITATION_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITATION_NOT_FOUND },
    });
  });

  it('이미 응답된 초대면 TIV_011로 거부한다', async () => {
    const { service } = declineService('not-pending');

    await expect(
      service.decline(syntheticGithubId, INVITATION_ID),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITATION_NOT_PENDING },
    });
  });
});

describe('TeamInvitationsService.accept', () => {
  it('수락에 성공하면 teamId·programId를 반환한다', async () => {
    const { service, repository } = buildService({
      withAcceptTransaction: jest.fn().mockResolvedValue({
        kind: 'ok',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
      }),
    });

    const result = await service.accept(syntheticGithubId, INVITATION_ID);

    expect(repository.withAcceptTransaction).toHaveBeenCalledWith(
      INVITATION_ID,
      syntheticUserId,
      expect.any(Date),
      expect.any(Function),
    );
    expect(result).toEqual({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('records TEAM_JOINED inside the accept transaction, not after it resolves', async () => {
    let acceptResolved = false;
    const record = jest
      .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
      .mockImplementation(() => {
        expect(acceptResolved).toBe(false);
        return Promise.resolve(undefined);
      });
    const auditLogWriter = {};
    const { service } = buildService(
      {
        withAcceptTransaction: jest.fn(
          async (
            _id: string,
            _inviteeId: string,
            _now: Date,
            onOk?: (
              store: { readonly auditLogWriter: unknown },
              names: {
                readonly teamId: string;
                readonly programId: string;
                readonly teamName: string;
                readonly programName: string;
              },
            ) => Promise<void>,
          ) => {
            if (onOk) {
              await onOk(
                { auditLogWriter },
                {
                  teamId: syntheticTeamId,
                  programId: syntheticProgramId,
                  teamName: '합성 팀',
                  programName: '합성 프로그램',
                },
              );
            }
            acceptResolved = true;
            return {
              kind: 'ok' as const,
              teamId: syntheticTeamId,
              programId: syntheticProgramId,
            };
          },
        ),
      },
      { record } as Pick<AuditLogService, 'record'>,
    );

    await service.accept(syntheticGithubId, INVITATION_ID);

    expect(record).toHaveBeenCalledTimes(1);
    expect(acceptResolved).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: syntheticGithubId,
        action: TEAM_JOINED_AUDIT_ACTIONS.TEAM_JOINED,
        targetType: 'TEAM',
        targetId: syntheticTeamId,
        metadata: {
          schemaVersion: 1,
          programName: '합성 프로그램',
          teamName: '합성 팀',
        },
      }),
      auditLogWriter,
    );
  });

  it.each([
    ['not-found', TeamInvitationErrorCode.INVITATION_NOT_FOUND],
    ['forbidden', TeamInvitationErrorCode.NOT_INVITEE],
    ['not-pending', TeamInvitationErrorCode.INVITATION_NOT_PENDING],
    ['already-in-team', TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM],
    ['team-full', TeamInvitationErrorCode.TEAM_FULL],
    ['invitee-not-eligible', TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE],
  ] as const)('outcome %s는 %s로 매핑된다', async (kind, expectedCode) => {
    const { service } = buildService({
      withAcceptTransaction: jest.fn().mockResolvedValue({ kind }),
    });

    await expect(
      service.accept(syntheticGithubId, INVITATION_ID),
    ).rejects.toMatchObject({ errorCode: { code: expectedCode } });
  });
});

describe('acceptTeamInvitationTransaction', () => {
  const OTHER_TEAM_INVITATION_ID = 'cuid-invitation-other-team';
  const RESPONDED_AT = new Date('2026-09-01T00:00:00.000Z');

  function invitationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: INVITATION_ID,
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      inviteeId: syntheticUserId,
      status: TeamInvitationStatus.PENDING,
      team: {
        name: '합성 팀',
        program: { teamMaxSize: 4, name: '합성 프로그램' },
      },
      ...overrides,
    };
  }

  function buildTx(overrides: Record<string, unknown> = {}) {
    return {
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitationRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(undefined),
      },
      team: { update: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: syntheticUserId,
          profile: { memberKind: MemberKind.STUDENT },
          accountStatus: AccountStatus.ACTIVE,
        }),
      },
      // 승인된 NEW 신청이 없는 팀이 기본값이다 — 조회는 진짜로 일어나고 빈 목록을 돌려준다.
      application: { findMany: jest.fn().mockResolvedValue([]) },
      outboxEvent: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
      ...overrides,
    };
  }

  function run(tx: ReturnType<typeof buildTx>, inviteeId = syntheticUserId) {
    const prisma = {
      $transaction: <T>(operation: (t: typeof tx) => Promise<T>) =>
        operation(tx),
    } as unknown as PrismaService;
    return acceptTeamInvitationTransaction(
      prisma,
      INVITATION_ID,
      inviteeId,
      RESPONDED_AT,
    );
  }

  it('신청 여부를 보지 않고 합류시키며 새 구성원은 팀장이 되지 않는다', async () => {
    const tx = buildTx();

    const outcome = await run(tx);

    expect(outcome).toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
    // 팀 행을 먼저 잠근 뒤에만 판정한다.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: {
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        userId: syntheticUserId,
      },
    });
    // 팀장은 그대로다 — 수락 경로는 Team 행을 갱신하지 않는다.
    expect(tx.team.update).not.toHaveBeenCalled();
  });

  it('같은 프로그램의 남은 대기 초대를 같은 트랜잭션에서 종결한다', async () => {
    const tx = buildTx();

    await run(tx);

    expect(tx.teamInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        status: TeamInvitationStatus.PENDING,
        id: { not: INVITATION_ID },
      },
      data: {
        status: TeamInvitationStatus.DECLINED,
        respondedAt: RESPONDED_AT,
      },
    });
  });

  it('초대받은 사람이 아니면 forbidden이다', async () => {
    const tx = buildTx();

    await expect(run(tx, 'cuid-someone-else')).resolves.toEqual({
      kind: 'forbidden',
    });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('이미 응답된 초대는 두 번 수락되지 않는다', async () => {
    const tx = buildTx();
    tx.teamInvitation.findUnique
      .mockResolvedValueOnce(invitationRow())
      .mockResolvedValueOnce(
        invitationRow({ status: TeamInvitationStatus.ACCEPTED }),
      );

    await expect(run(tx)).resolves.toEqual({ kind: 'not-pending' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('승인된 NEW 신청은 같은 트랜잭션에서 권한 동기화 outbox 이벤트로 예약된다', async () => {
    const tx = buildTx();
    tx.application.findMany.mockResolvedValue([{ id: syntheticApplicationId }]);

    await expect(run(tx)).resolves.toEqual({
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
    const requestedAt = RESPONDED_AT.toISOString();
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
          availableAt: RESPONDED_AT,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('승인된 NEW 신청이 없는 팀은 outbox에 아무것도 쓰지 않는다', async () => {
    const tx = buildTx();

    await expect(run(tx)).resolves.toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
    expect(tx.application.findMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('outbox 예약이 실패하면 트랜잭션 밖으로 전파해 합류까지 롤백된다', async () => {
    const boom = new Error('outbox write failed');
    const tx = buildTx();
    tx.application.findMany.mockResolvedValue([{ id: syntheticApplicationId }]);
    tx.outboxEvent.createMany.mockRejectedValue(boom);

    await expect(run(tx)).rejects.toBe(boom);
    expect(tx.teamMember.create).toHaveBeenCalledTimes(1);
  });

  it('수락이 거부되면 권한 동기화 대상을 조회하지도 않는다', async () => {
    const tx = buildTx();
    tx.teamMember.count.mockResolvedValue(4);

    await expect(run(tx)).resolves.toEqual({ kind: 'team-full' });
    expect(tx.application.findMany).not.toHaveBeenCalled();
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('잠금 뒤 CAS가 0건이면 not-pending으로 되돌린다', async () => {
    const tx = buildTx();
    tx.teamInvitation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(run(tx)).resolves.toEqual({ kind: 'not-pending' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      '비활성 계정',
      {
        id: syntheticUserId,
        profile: { memberKind: MemberKind.STUDENT },
        accountStatus: AccountStatus.DEACTIVATED,
      },
    ],
    [
      '학생이 아닌 계정',
      {
        id: syntheticUserId,
        profile: { memberKind: MemberKind.STAFF },
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
    [
      '프로필 없음',
      {
        id: syntheticUserId,
        profile: null,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
  ])('%s는 invitee-not-eligible이다', async (_label, user) => {
    const tx = buildTx();
    tx.user.findUnique.mockResolvedValue(user);

    await expect(run(tx)).resolves.toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('잠금 뒤 이미 이 프로그램 팀에 소속됐으면 already-in-team이다', async () => {
    const tx = buildTx();
    tx.teamMember.findUnique.mockResolvedValue({ userId: syntheticUserId });

    await expect(run(tx)).resolves.toEqual({ kind: 'already-in-team' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('잠금 뒤 정원이 찼으면 team-full이다', async () => {
    const tx = buildTx();
    tx.teamMember.count.mockResolvedValue(4);

    await expect(run(tx)).resolves.toEqual({ kind: 'team-full' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('다른 팀 초대 id로는 이 초대를 수락할 수 없다', async () => {
    const tx = buildTx({
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    });
    const prisma = {
      $transaction: <T>(operation: (t: typeof tx) => Promise<T>) =>
        operation(tx),
    } as unknown as PrismaService;

    await expect(
      acceptTeamInvitationTransaction(
        prisma,
        OTHER_TEAM_INVITATION_ID,
        syntheticUserId,
        RESPONDED_AT,
      ),
    ).resolves.toEqual({ kind: 'not-found' });
  });
});
