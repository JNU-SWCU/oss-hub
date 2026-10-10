import { Prisma } from '@prisma/client';
import { ApplicationsRepository } from './applications.repository';
import type { PrismaService } from '../../prisma/prisma.service';

const TEAM_ID = 'synthetic-team';
const LEADER_ID = 'synthetic-leader';
const MEMBER_ID = 'synthetic-member';

type LockQueryMock = jest.Mock<Promise<unknown>, [Prisma.Sql]>;

function buildStoreHarness(overrides: {
  readonly lockedRows: readonly { id: string; leaderId: string }[];
  readonly membership?: { id: string } | null;
}) {
  const queryRaw: LockQueryMock = jest
    .fn<Promise<unknown>, [Prisma.Sql]>()
    .mockResolvedValue(overrides.lockedRows);
  const teamMemberFindUnique = jest
    .fn()
    .mockResolvedValue(overrides.membership ?? null);
  const transaction = {
    $queryRaw: queryRaw,
    teamMember: { findUnique: teamMemberFindUnique },
  };
  const prisma = {
    $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  } as unknown as PrismaService;
  const repository = new ApplicationsRepository(prisma);
  return { repository, queryRaw, teamMemberFindUnique };
}

function lockedSqlOf(queryRaw: LockQueryMock): Prisma.Sql {
  const call = queryRaw.mock.calls[0];
  if (call === undefined) {
    throw new Error('expected a Team FOR UPDATE query');
  }
  return call[0];
}

describe('PrismaApplicationCreateStore.lockTeamForApply', () => {
  it('현재 팀장이면서 현재 구성원일 때만 true 를 돌려준다', async () => {
    const { repository, queryRaw, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-1' },
    });

    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    expect(allowed).toBe(true);
    const sql = lockedSqlOf(queryRaw);
    expect(sql.sql).toContain('FOR UPDATE');
    expect(sql.sql).toContain('"leaderId"');
    expect(sql.values).toContain(TEAM_ID);
    expect(teamMemberFindUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: TEAM_ID, userId: LEADER_ID } },
      select: { id: true },
    });
  });

  it('팀장이 아닌 구성원에게는 false 를 돌려준다', async () => {
    const { repository, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-2' },
    });

    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, MEMBER_ID),
    );

    expect(allowed).toBe(false);
    expect(teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it('잠글 팀 행이 없으면 false 를 돌려준다', async () => {
    const { repository } = buildStoreHarness({ lockedRows: [] });

    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    expect(allowed).toBe(false);
  });

  it('팀장 자리는 그대로여도 구성원 행이 사라졌으면 false 를 돌려준다', async () => {
    const { repository } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: null,
    });

    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    expect(allowed).toBe(false);
  });

  it('권한 판정은 언제나 FOR UPDATE 잠금 뒤에 읽는다', async () => {
    const { repository, queryRaw, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-3' },
    });

    await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    const lockOrder = queryRaw.mock.invocationCallOrder[0] ?? 0;
    const membershipOrder =
      teamMemberFindUnique.mock.invocationCallOrder[0] ?? 0;
    expect(lockOrder).toBeLessThan(membershipOrder);
  });
});
