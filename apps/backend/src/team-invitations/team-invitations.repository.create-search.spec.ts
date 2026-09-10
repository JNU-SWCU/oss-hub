import { Prisma, TeamInvitationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticTeamId = 'cuid-synthetic-team';
const syntheticInviteeId = 'cuid-synthetic-invitee';
const syntheticLeaderId = 'cuid-synthetic-leader';
const invitedAt = new Date('2026-08-01T00:00:00.000Z');

const SENT_TEAM_INVITATION_SELECT = {
  id: true,
  teamId: true,
  programId: true,
  inviteeId: true,
  invitedById: true,
  status: true,
  invitedAt: true,
  respondedAt: true,
  invitee: {
    select: {
      id: true,
      nickname: true,
      profile: { select: { name: true } },
      avatarUrl: true,
    },
  },
} as const;

const selectedInvitationRow = {
  id: 'cuid-invitation',
  teamId: syntheticTeamId,
  programId: syntheticProgramId,
  inviteeId: syntheticInviteeId,
  invitedById: syntheticLeaderId,
  status: TeamInvitationStatus.PENDING,
  invitedAt,
  respondedAt: null,
  invitee: {
    id: syntheticInviteeId,
    nickname: 'synthetic-invitee',
    profile: { name: '합성 초대 대상' },
    avatarUrl: 'https://example.invalid/avatar.png',
  },
};

const projectedInvitee = {
  id: syntheticInviteeId,
  nickname: 'synthetic-invitee',
  name: '합성 초대 대상',
  avatarUrl: 'https://example.invalid/avatar.png',
};

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('conflict', {
    code,
    clientVersion: 'test',
  });
}

describe('TeamInvitationsRepository.searchCandidates', () => {
  it('nickname·name 부분 일치(대소문자 무시)로 찾고 본인·같은 프로그램 소속을 제외한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { user: { findMany } };
    const repository = new TeamInvitationsRepository(
      prisma as unknown as PrismaService,
    );

    await repository.searchCandidates(
      syntheticProgramId,
      'octo',
      syntheticInviteeId,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { not: syntheticInviteeId },
        profile: { is: { memberKind: 'STUDENT' } },
        accountStatus: 'ACTIVE',
        OR: [
          { nickname: { contains: 'octo', mode: 'insensitive' } },
          // 이름의 정본은 프로필 행뿐이라 legacy fallback 갈래가 사라졌다.
          {
            profile: {
              is: { name: { contains: 'octo', mode: 'insensitive' } },
            },
          },
        ],
        teamMemberships: { none: { programId: syntheticProgramId } },
      },
      select: {
        id: true,
        nickname: true,
        profile: { select: { name: true } },
        avatarUrl: true,
      },
      orderBy: { nickname: 'asc' },
      take: 20,
    });
  });
});

describe('TeamInvitationsRepository.findByTeamId', () => {
  it('보낸 초대는 초대 대상의 허용된 표시 정보만 select·투영한다', async () => {
    const findMany = jest.fn().mockResolvedValue([selectedInvitationRow]);
    const repository = new TeamInvitationsRepository({
      teamInvitation: { findMany },
    } as unknown as PrismaService);

    const result = await repository.findByTeamId(syntheticTeamId);

    expect(findMany).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
      orderBy: { invitedAt: 'desc' },
      select: SENT_TEAM_INVITATION_SELECT,
    });
    expect(result).toEqual([
      {
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt,
        respondedAt: null,
        invitee: projectedInvitee,
      },
    ]);
    expect(Object.keys(result[0]!.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
  });
});

describe('TeamInvitationsRepository.createInvitation', () => {
  interface TxOptions {
    /** 팀 행을 잠근 뒤 다시 읽은 팀. `null`이면 사라진 팀이다. */
    readonly team?: {
      readonly id: string;
      readonly programId: string;
      readonly leaderId: string;
      readonly program: { readonly teamMaxSize: number };
    } | null;
    readonly actorMembership?: { readonly userId: string } | null;
    readonly inviteeMembership?: { readonly userId: string } | null;
    readonly memberCount?: number;
    readonly create?: jest.Mock;
  }

  const lockedTeam = {
    id: syntheticTeamId,
    programId: syntheticProgramId,
    leaderId: syntheticLeaderId,
    program: { teamMaxSize: 4 },
  };

  function buildTx(options: TxOptions = {}) {
    const team = options.team === undefined ? lockedTeam : options.team;
    const teamFindUnique = jest.fn().mockResolvedValue(team);
    const memberFindUnique = jest.fn(
      (args: { where: Record<string, unknown> }) => {
        if ('teamId_userId' in args.where) {
          return Promise.resolve(
            options.actorMembership === undefined
              ? { userId: syntheticLeaderId }
              : options.actorMembership,
          );
        }
        return Promise.resolve(options.inviteeMembership ?? null);
      },
    );
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
      team: { findUnique: teamFindUnique },
      teamMember: {
        findUnique: memberFindUnique,
        count: jest.fn().mockResolvedValue(options.memberCount ?? 1),
      },
      teamInvitation: {
        create:
          options.create ?? jest.fn().mockResolvedValue(selectedInvitationRow),
      },
    };
  }

  function buildRepository(tx: object) {
    return new TeamInvitationsRepository({
      $transaction: <T>(operation: (transaction: never) => Promise<T>) =>
        operation(tx as never),
    } as unknown as PrismaService);
  }

  function invite(repository: TeamInvitationsRepository, now?: Date) {
    return repository.createInvitation(
      {
        teamId: syntheticTeamId,
        actorId: syntheticLeaderId,
        inviteeId: syntheticInviteeId,
      },
      now,
    );
  }

  it('팀 행을 FOR UPDATE로 잠근 뒤 판정하고 ok outcome에 초대 대상을 투영한다', async () => {
    const create = jest.fn().mockResolvedValue(selectedInvitationRow);
    const tx = buildTx({ create });
    const outcome = await invite(buildRepository(tx), invitedAt);

    const [lockSql] = tx.$queryRaw.mock.calls[0] as [Prisma.Sql];
    expect(lockSql.sql).toContain('FOR UPDATE');
    expect(lockSql.values).toEqual([syntheticTeamId]);
    expect(create).toHaveBeenCalledWith({
      data: {
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: syntheticLeaderId,
        invitedAt,
      },
      select: SENT_TEAM_INVITATION_SELECT,
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    expect(outcome.invitation.invitee).toEqual(projectedInvitee);
    expect(Object.keys(outcome.invitation.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
  });

  /**
   * 신청 제출 여부는 더 이상 초대 생성의 조건이 아니다 — 트랜잭션은 Application을
   * 조회조차 하지 않는다.
   */
  it('신청을 제출한 팀도 Application을 조회하지 않고 초대를 만든다', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'cuid-application' });
    const tx = { ...buildTx(), application: { findFirst } };
    const outcome = await invite(buildRepository(tx));

    expect(outcome.kind).toBe('ok');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('프로필이 없으면 invitee.name은 null이다', async () => {
    const create = jest.fn().mockResolvedValue({
      ...selectedInvitationRow,
      invitee: {
        id: syntheticInviteeId,
        nickname: 'synthetic-invitee',
        profile: null,
        avatarUrl: null,
      },
    });
    const outcome = await invite(buildRepository(buildTx({ create })));

    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    expect(outcome.invitation.invitee).toEqual({
      id: syntheticInviteeId,
      nickname: 'synthetic-invitee',
      name: null,
      avatarUrl: null,
    });
  });

  it('잠근 뒤 팀이 없으면 team-not-found를 반환하고 생성하지 않는다', async () => {
    const create = jest.fn();
    const tx = buildTx({ team: null, create });

    await expect(invite(buildRepository(tx))).resolves.toEqual({
      kind: 'team-not-found',
    });
    expect(create).not.toHaveBeenCalled();
  });

  /** 승계로 팀장이 바뀐 뒤라면 잠금 전 스냅샷이 무엇이었든 통과하지 못한다. */
  it('잠근 뒤 팀장이 아니면 대상의 소속을 조회하지 않고 not-team-leader를 반환한다', async () => {
    const create = jest.fn();
    const tx = buildTx({
      team: { ...lockedTeam, leaderId: 'cuid-synthetic-new-leader' },
      create,
    });

    await expect(invite(buildRepository(tx))).resolves.toEqual({
      kind: 'not-team-leader',
    });
    expect(tx.teamMember.findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('팀장 행만 남고 구성원 행이 없으면 not-team-member를 반환한다', async () => {
    const create = jest.fn();
    const tx = buildTx({ actorMembership: null, create });

    await expect(invite(buildRepository(tx))).resolves.toEqual({
      kind: 'not-team-member',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('대상이 같은 프로그램의 팀에 이미 있으면 invitee-already-in-team을 반환한다', async () => {
    const create = jest.fn();
    const tx = buildTx({
      inviteeMembership: { userId: syntheticInviteeId },
      create,
    });

    await expect(invite(buildRepository(tx))).resolves.toEqual({
      kind: 'invitee-already-in-team',
    });
    expect(tx.teamMember.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        programId_userId: {
          programId: syntheticProgramId,
          userId: syntheticInviteeId,
        },
      },
      select: { userId: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('정원이 이미 찼으면 team-full을 반환한다', async () => {
    const create = jest.fn();
    const tx = buildTx({ memberCount: 4, create });

    await expect(invite(buildRepository(tx))).resolves.toEqual({
      kind: 'team-full',
    });
    expect(tx.teamMember.count).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('정원 직전 인원이면 초대를 만든다', async () => {
    const tx = buildTx({ memberCount: 3 });

    await expect(invite(buildRepository(tx))).resolves.toMatchObject({
      kind: 'ok',
    });
  });

  it('P2002는 already-invited outcome으로 바꾼다', async () => {
    const create = jest.fn().mockRejectedValue(knownRequestError('P2002'));

    await expect(invite(buildRepository(buildTx({ create })))).resolves.toEqual(
      { kind: 'already-invited' },
    );
  });

  it('partial unique 위반(raw 23505)도 already-invited outcome으로 바꾼다', async () => {
    const create = jest.fn().mockRejectedValue(knownRequestError('23505'));

    await expect(invite(buildRepository(buildTx({ create })))).resolves.toEqual(
      { kind: 'already-invited' },
    );
  });

  it('다른 에러는 그대로 전파한다', async () => {
    const boom = new Error('boom');
    const create = jest.fn().mockRejectedValue(boom);

    await expect(invite(buildRepository(buildTx({ create })))).rejects.toBe(
      boom,
    );
  });
});
