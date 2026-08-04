import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PendingInvitationConflictError,
  TeamInvitationsRepository,
} from './team-invitations.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticTeamId = 'cuid-synthetic-team';
const syntheticInviteeId = 'cuid-synthetic-invitee';

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
        OR: [
          { nickname: { contains: 'octo', mode: 'insensitive' } },
          { name: { contains: 'octo', mode: 'insensitive' } },
        ],
        teamMemberships: { none: { programId: syntheticProgramId } },
      },
      select: { id: true, nickname: true, name: true, avatarUrl: true },
      orderBy: { nickname: 'asc' },
      take: 20,
    });
  });
});

describe('TeamInvitationsRepository.createInvitation', () => {
  it('P2002는 PendingInvitationConflictError로 변환한다', async () => {
    const create = jest.fn().mockRejectedValue(knownRequestError('P2002'));
    const prisma = { teamInvitation: { create } };
    const repository = new TeamInvitationsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.createInvitation({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: 'cuid-synthetic-leader',
      }),
    ).rejects.toBeInstanceOf(PendingInvitationConflictError);
  });

  it('partial unique 위반(raw 23505)도 PendingInvitationConflictError로 변환한다', async () => {
    const create = jest.fn().mockRejectedValue(knownRequestError('23505'));
    const prisma = { teamInvitation: { create } };
    const repository = new TeamInvitationsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.createInvitation({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: 'cuid-synthetic-leader',
      }),
    ).rejects.toBeInstanceOf(PendingInvitationConflictError);
  });

  it('다른 에러는 그대로 전파한다', async () => {
    const boom = new Error('boom');
    const create = jest.fn().mockRejectedValue(boom);
    const prisma = { teamInvitation: { create } };
    const repository = new TeamInvitationsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.createInvitation({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: 'cuid-synthetic-leader',
      }),
    ).rejects.toBe(boom);
  });
});

describe('TeamInvitationsRepository.withAcceptTransaction', () => {
  function buildTx(overrides: Record<string, unknown> = {}) {
    return {
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cuid-invitation',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          inviteeId: syntheticInviteeId,
          team: { program: { teamMaxSize: 4 } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(undefined),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
      ...overrides,
    };
  }

  function buildRepository(tx: ReturnType<typeof buildTx>) {
    const prisma = {
      $transaction: <T>(operation: (t: typeof tx) => Promise<T>) =>
        operation(tx),
    };
    return new TeamInvitationsRepository(prisma as unknown as PrismaService);
  }

  it('초대가 없으면 not-found를 반환한다', async () => {
    const tx = buildTx({
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'not-found' });
  });

  it('초대받은 사람이 아니면 forbidden을 반환한다', async () => {
    const tx = buildTx();
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      'cuid-someone-else',
    );

    expect(outcome).toEqual({ kind: 'forbidden' });
  });

  it('팀 행을 FOR UPDATE로 잠근 뒤 status=PENDING 조건으로 원자 전이한다', async () => {
    const tx = buildTx();
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.teamInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'cuid-invitation', status: 'PENDING' },
      data: expect.objectContaining({ status: 'ACCEPTED' }) as unknown,
    });
    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: {
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        userId: syntheticInviteeId,
      },
    });
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('updateMany count가 0이면 not-pending을 반환하고 멤버를 만들지 않는다', async () => {
    const tx = buildTx({
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cuid-invitation',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          inviteeId: syntheticInviteeId,
          team: { program: { teamMaxSize: 4 } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'not-pending' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('이미 같은 프로그램 팀에 소속돼 있으면 already-in-team을 반환한다', async () => {
    const tx = buildTx({
      teamMember: {
        findUnique: jest.fn().mockResolvedValue({ userId: syntheticInviteeId }),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'already-in-team' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('정원이 이미 찼으면 team-full을 반환한다', async () => {
    const tx = buildTx({
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(4),
        create: jest.fn(),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'team-full' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('teamMaxSize가 null이면 정원 검사를 건너뛴다', async () => {
    const tx = buildTx({
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cuid-invitation',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          inviteeId: syntheticInviteeId,
          team: { program: { teamMaxSize: null } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(tx.teamMember.count).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: 'ok',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('teamMember.create가 P2002로 실패하면 already-in-team으로 흡수한다(경합)', async () => {
    const tx = buildTx({
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockRejectedValue(knownRequestError('P2002')),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'already-in-team' });
  });
});
