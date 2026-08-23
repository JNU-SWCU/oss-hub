import { AccountStatus, MemberKind, Prisma } from '@prisma/client';
import { lockActiveAdminRows, toAdminActor } from './admin-actor-locks';

type ActorRow = Parameters<typeof toAdminActor>[0];

function actorRow(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    id: 'actor',
    githubId: 9_140_000_001n,
    nickname: 'synthetic-actor',
    selectedMemberKind: MemberKind.STUDENT,
    selectedRole: 'STUDENT',
    hasStaffAccess: null,
    hasAdminAccess: null,
    accountStatus: AccountStatus.ACTIVE,
    profile: null,
    ...overrides,
  };
}

/**
 * actor 행이 인가 판정으로 넘어갈 때 접근 권한을 **무엇에서** 읽는지 고정한다.
 *
 * expand 단계라 `hasStaffAccess`·`hasAdminAccess`는 아직 nullable이다. 값이 있으면 그것이
 * 정본이고, `NULL`인 backfill 이전 행만 legacy `role`로 떨어진다 — 그 우선순위가 뒤집히면
 * 독립 권한 부여(`independent-authority-transition.ts`)로 갈라 둔 상태가 인가에서 무시된다.
 */
describe('toAdminActor', () => {
  it('takes canonical access columns as the source of truth over the legacy role', () => {
    // Given: role은 STAFF지만 canonical로는 관리자인 행
    const row = actorRow({
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    // When
    const actor = toAdminActor(row);

    // Then
    expect(actor.hasStaffAccess).toBe(true);
    expect(actor.hasAdminAccess).toBe(true);
  });

  it('reports no access when the canonical columns deny it despite an ADMIN role', () => {
    // Given
    const row = actorRow({
      hasAdminAccess: true,
      hasStaffAccess: false,
    });

    // When
    const actor = toAdminActor(row);

    // Then
    expect(actor.hasStaffAccess).toBe(false);
    expect(actor.hasAdminAccess).toBe(false);
  });

  it.each([
    ['ADMIN', true, true],
    ['STAFF', true, false],
    ['STUDENT', false, false],
    [null, false, false],
  ] as const)(
    'falls back to the legacy role %s for rows the backfill has not reached',
    (role, hasStaffAccess, hasAdminAccess) => {
      // Given: canonical 칸이 아직 NULL인 행
      const row = actorRow({
        role,
        hasStaffAccess: null,
        hasAdminAccess: null,
      });

      // When
      const actor = toAdminActor(row);

      // Then
      expect(actor.hasStaffAccess).toBe(hasStaffAccess);
      expect(actor.hasAdminAccess).toBe(hasAdminAccess);
      expect(actor.role).toBe(role);
    },
  );
});

/**
 * 이 잠금은 일부러 canonical 칸을 안 센다.
 *
 * 지키는 불변식이 "활성 ADMIN **역할**이 최소 하나"이고, #996 이후 legacy 역할 변경은
 * canonical 권한을 지우지 않으므로 ADMIN→STAFF로 강등된 행은 `hasAdminAccess`가
 * `true`로 남는다. 그 칸을 세면 강등된 사람이 활성 관리자로 계속 잡혀 마지막 관리자
 * 가드가 끩는다.
 */
describe('lockActiveAdminRows', () => {
  it('counts active admins by the legacy role column that the guard is defined over', async () => {
    // Given
    const queries: Prisma.Sql[] = [];
    const transaction = {
      $queryRaw: (query: Prisma.Sql) => {
        queries.push(query);
        return Promise.resolve([{ id: 'admin-a' }, { id: 'admin-b' }]);
      },
    } as unknown as Prisma.TransactionClient;

    // When
    const count = await lockActiveAdminRows(transaction);

    // Then
    expect(count).toBe(2);
    expect(queries).toHaveLength(1);
    const query = queries.at(0);
    if (!query) {
      throw new Error('expected the lock to issue exactly one query');
    }
    const sql = query.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('WHERE role =');
    expect(sql).not.toContain('hasAdminAccess');
    expect(sql).toContain('FOR UPDATE');
    expect(query.values).toContain('ADMIN');
    expect(query.values).toContain(AccountStatus.ACTIVE);
  });
});
