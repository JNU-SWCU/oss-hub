import { AccountStatus, MemberKind, Prisma } from '@prisma/client';
import { lockActiveAdminRows, toAdminActor } from './admin-actor-locks';

type ActorRow = Parameters<typeof toAdminActor>[0];

function actorRow(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    id: 'actor',
    githubId: 9_140_000_001n,
    nickname: 'synthetic-actor',
    selectedMemberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    profile: null,
    ...overrides,
  };
}

/**
 * actor 행이 인가 판정으로 넘어갈 때 접근 권한을 **무엇에서** 읽는지 고정한다.
 *
 * 계약 단계 이후 `hasStaffAccess`·`hasAdminAccess`가 유일한 정본이다. 표시 역할
 * (`role`)은 세 사실을 접은 요약이라 판정에 쓰이지 않는다 — 접는 순간 학생 관리자의
 * 학생이라는 사실이 사라지기 때문이다.
 */
describe('toAdminActor', () => {
  it('takes canonical access columns as the source of truth', () => {
    // Given: 교직원 접근과 관리자 접근을 함께 가진 행
    const row = actorRow({
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    // When
    const actor = toAdminActor(row);

    // Then
    expect(actor.hasStaffAccess).toBe(true);
    expect(actor.hasAdminAccess).toBe(true);
  });

  // 관리자 권한이 교직원 권한을 함의하지 않는다 — 관리자가 곧 교직원은 아니다.
  it('does not imply staff access from admin access', () => {
    // Given
    const row = actorRow({ hasAdminAccess: true, hasStaffAccess: false });

    // When
    const actor = toAdminActor(row);

    // Then
    expect(actor.hasStaffAccess).toBe(false);
    expect(actor.hasAdminAccess).toBe(true);
  });

  it.each([
    [MemberKind.STUDENT, false, false, 'STUDENT'],
    [MemberKind.STUDENT, false, true, 'ADMIN'],
    [MemberKind.STAFF, true, false, 'STAFF'],
    [null, false, false, null],
  ] as const)(
    'folds (%s, staff=%s, admin=%s) into the display role %s',
    (selectedMemberKind, hasStaffAccess, hasAdminAccess, expected) => {
      // Given
      const row = actorRow({
        selectedMemberKind,
        hasStaffAccess,
        hasAdminAccess,
      });

      // When
      const actor = toAdminActor(row);

      // Then — 표시 값은 접히지만 판정용 두 칸은 그대로 살아 있다
      expect(actor.role).toBe(expected);
      expect(actor.hasStaffAccess).toBe(hasStaffAccess);
      expect(actor.hasAdminAccess).toBe(hasAdminAccess);
    },
  );
});

/**
 * 이 잠금은 `hasAdminAccess`를 센다.
 *
 * 계약 마이그레이션이 legacy `role`을 지운 뒤로는 그 칸이 관리자 권한의 유일한
 * 정본이고, 권한을 옮기는 모든 경로가 그 칸만 쓴다. 두 칸이 갈라질 수 있던 호환
 * 구간은 끝났으므로 여기서 세는 집합과 전이가 바꾸는 집합이 같다.
 */
describe('lockActiveAdminRows', () => {
  it('counts active admins by the canonical hasAdminAccess column', async () => {
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
    expect(sql).toContain('"hasAdminAccess" = TRUE');
    expect(sql).not.toContain('role');
    expect(sql).toContain('FOR UPDATE');
    expect(query.values).toContain(AccountStatus.ACTIVE);
  });
});
