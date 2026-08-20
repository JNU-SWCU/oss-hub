import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PendingInvitationConflictError,
  TeamInvitationLockedError,
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
        role: 'STUDENT',
        accountStatus: 'ACTIVE',
        OR: [
          { nickname: { contains: 'octo', mode: 'insensitive' } },
          {
            OR: [
              {
                profile: {
                  is: {
                    name: { contains: 'octo', mode: 'insensitive' },
                  },
                },
              },
              {
                profile: { is: null },
                name: { contains: 'octo', mode: 'insensitive' },
              },
            ],
          },
        ],
        teamMemberships: { none: { programId: syntheticProgramId } },
      },
      select: {
        id: true,
        nickname: true,
        name: true,
        profile: { select: { name: true } },
        avatarUrl: true,
      },
      orderBy: { nickname: 'asc' },
      take: 20,
    });
  });
});

describe('TeamInvitationsRepository.createInvitation', () => {
  function buildRepository(
    create: jest.Mock,
    application: { readonly id: string } | null = null,
  ): TeamInvitationsRepository {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
      application: { findFirst: jest.fn().mockResolvedValue(application) },
      teamInvitation: { create },
    };
    return new TeamInvitationsRepository({
      $transaction: <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    } as unknown as PrismaService);
  }

  it('P2002는 PendingInvitationConflictError로 변환한다', async () => {
    const create = jest.fn().mockRejectedValue(knownRequestError('P2002'));
    const repository = buildRepository(create);

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
    const repository = buildRepository(create);

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
    const repository = buildRepository(create);

    await expect(
      repository.createInvitation({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: 'cuid-synthetic-leader',
      }),
    ).rejects.toBe(boom);
  });

  it('신청서가 있는 팀은 새 초대 생성을 거부한다', async () => {
    const create = jest.fn();
    const repository = buildRepository(create, { id: 'application-1' });

    await expect(
      repository.createInvitation({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticInviteeId,
        invitedById: 'cuid-synthetic-leader',
      }),
    ).rejects.toBeInstanceOf(TeamInvitationLockedError);
    expect(create).not.toHaveBeenCalled();
  });
});
