import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';

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

describe('TeamInvitationsRepository.withAcceptTransaction', () => {
  function buildTx(overrides: Record<string, unknown> = {}) {
    return {
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cuid-invitation',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          inviteeId: syntheticInviteeId,
          status: 'PENDING',
          team: { program: { teamMaxSize: 4 } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(undefined),
      },
      application: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: syntheticInviteeId,
          hasStaffAccess: false,
          hasAdminAccess: false,
          accountStatus: 'ACTIVE',
        }),
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
          status: 'PENDING',
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

  it('팀 잠금 뒤 초대 상태를 다시 읽어 이미 응답된 초대를 거부한다', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        status: 'PENDING',
        team: { program: { teamMaxSize: 4 } },
      })
      .mockResolvedValueOnce({ status: 'ACCEPTED' });
    const tx = buildTx({
      teamInvitation: {
        findUnique,
        updateMany: jest.fn(),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'cuid-invitation' },
      select: { status: true },
    });
    expect(outcome).toEqual({ kind: 'not-pending' });
    expect(tx.teamInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.teamMember.findUnique).not.toHaveBeenCalled();
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('신청서가 있는 잠긴 팀은 초대 수락을 거부한다', async () => {
    const tx = buildTx({
      application: {
        findFirst: jest.fn().mockResolvedValue({ id: 'application-1' }),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(outcome).toEqual({ kind: 'team-locked' });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
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

  it('정원 미만이면 인원수를 확인하고 초대를 수락한다', async () => {
    const tx = buildTx({
      teamInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cuid-invitation',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          inviteeId: syntheticInviteeId,
          status: 'PENDING',
          team: { program: { teamMaxSize: 4 } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const repository = buildRepository(tx);

    const outcome = await repository.withAcceptTransaction(
      'cuid-invitation',
      syntheticInviteeId,
    );

    expect(tx.teamMember.count).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
    });
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
