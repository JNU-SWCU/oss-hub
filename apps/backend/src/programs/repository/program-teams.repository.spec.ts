import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramTeamsRepository } from './program-teams.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticTeamId = 'cuid-synthetic-team';

function buildTx(overrides: Record<string, unknown> = {}) {
  return {
    teamMember: {
      count: jest.fn().mockResolvedValue(1),
    },
    application: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: syntheticTeamId }]),
    ...overrides,
  };
}

function buildRepository(tx: ReturnType<typeof buildTx>) {
  const prisma = {
    $transaction: <T>(operation: (t: typeof tx) => Promise<T>) => operation(tx),
  };
  return new ProgramTeamsRepository(prisma as unknown as PrismaService);
}

describe('ProgramTeamsRepository.withJoinTransaction / lockTeamForJoin', () => {
  it('팀 행을 FOR UPDATE로 잠근 뒤 정원·신청 상태를 다시 읽는다 (#164 패턴)', async () => {
    const tx = buildTx({
      teamMember: { count: jest.fn().mockResolvedValue(3) },
      application: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const repository = buildRepository(tx);

    const result = await repository.withJoinTransaction((store) =>
      store.lockTeamForJoin(syntheticTeamId),
    );

    const queryRaw: jest.Mock = tx.$queryRaw;
    expect(queryRaw).toHaveBeenCalled();
    const [call] = queryRaw.mock.calls as [[Prisma.Sql]];
    const [sql] = call;
    expect(sql.sql).toContain('FOR UPDATE');
    expect(tx.teamMember.count).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
    });
    expect(tx.application.findFirst).toHaveBeenCalledWith({
      where: { teamId: syntheticTeamId },
      select: { id: true },
    });
    expect(result).toEqual({ memberCount: 3, hasApplication: false });
  });

  it('신청이 존재하면 hasApplication=true로 재조회한다', async () => {
    const tx = buildTx({
      application: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cuid-application' }),
      },
    });
    const repository = buildRepository(tx);

    const result = await repository.withJoinTransaction((store) =>
      store.lockTeamForJoin(syntheticTeamId),
    );

    expect(result).toEqual({ memberCount: 1, hasApplication: true });
  });
});
