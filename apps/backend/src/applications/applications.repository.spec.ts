import { Prisma } from '@prisma/client';
import { ApplicationsRepository } from './applications.repository';
import type { PrismaService } from '../prisma/prisma.service';

const TEAM_ID = 'synthetic-team';
const LEADER_ID = 'synthetic-leader';
const MEMBER_ID = 'synthetic-member';

/**
 * #1269 — `lockTeamForApply`는 잠그기만 하는 함수가 아니다. 팀을 FOR UPDATE로 잠근 **뒤의**
 * 사실(현재 `Team.leaderId`와 현재 `TeamMember` 행)로 신청 제출 권한을 되읽어 돌려준다.
 * 잠금 전에 읽은 멤버십 스냅샷은 권한의 정본이 아니다 — 그 사이에 팀장이 바뀌거나 본인이
 * 팀에서 빠졌을 수 있다.
 */
/** `$queryRaw(Prisma.sql`…`)` 호출 계약 — 첫 인자가 잠금 SQL 이다. */
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
  const repository = new ApplicationsRepository(prisma, {
    TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
  });
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
    // Given
    const { repository, queryRaw, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-1' },
    });

    // When
    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    // Then
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
    // Given — 초대로 합류만 한 팀원.
    const { repository, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-2' },
    });

    // When
    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, MEMBER_ID),
    );

    // Then — 팀장 판정에서 이미 걸리므로 멤버십을 더 묻지 않는다.
    expect(allowed).toBe(false);
    expect(teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it('잠글 팀 행이 없으면 false 를 돌려준다', async () => {
    // Given
    const { repository } = buildStoreHarness({ lockedRows: [] });

    // When
    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    // Then
    expect(allowed).toBe(false);
  });

  it('팀장 자리는 그대로여도 구성원 행이 사라졌으면 false 를 돌려준다', async () => {
    // Given — 잠금 직전에 팀에서 빠진 경우(레이스).
    const { repository } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: null,
    });

    // When
    const allowed = await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    // Then
    expect(allowed).toBe(false);
  });

  it('권한 판정은 언제나 FOR UPDATE 잠금 뒤에 읽는다', async () => {
    // Given
    const { repository, queryRaw, teamMemberFindUnique } = buildStoreHarness({
      lockedRows: [{ id: TEAM_ID, leaderId: LEADER_ID }],
      membership: { id: 'membership-3' },
    });

    // When
    await repository.withCreateTransaction((store) =>
      store.lockTeamForApply(TEAM_ID, LEADER_ID),
    );

    // Then
    const lockOrder = queryRaw.mock.invocationCallOrder[0] ?? 0;
    const membershipOrder =
      teamMemberFindUnique.mock.invocationCallOrder[0] ?? 0;
    expect(lockOrder).toBeLessThan(membershipOrder);
  });
});
