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

describe('toAdminActor', () => {
  it('takes canonical access columns as the source of truth', () => {
    const row = actorRow({
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    const actor = toAdminActor(row);

    expect(actor.hasStaffAccess).toBe(true);
    expect(actor.hasAdminAccess).toBe(true);
  });

  it('does not imply staff access from admin access', () => {
    const row = actorRow({ hasAdminAccess: true, hasStaffAccess: false });

    const actor = toAdminActor(row);

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
      const row = actorRow({
        selectedMemberKind,
        hasStaffAccess,
        hasAdminAccess,
      });

      const actor = toAdminActor(row);

      expect(actor.role).toBe(expected);
      expect(actor.hasStaffAccess).toBe(hasStaffAccess);
      expect(actor.hasAdminAccess).toBe(hasAdminAccess);
    },
  );
});

describe('lockActiveAdminRows', () => {
  it('counts active admins by the canonical hasAdminAccess column', async () => {
    const queries: Prisma.Sql[] = [];
    const transaction = {
      $queryRaw: (query: Prisma.Sql) => {
        queries.push(query);
        return Promise.resolve([{ id: 'admin-a' }, { id: 'admin-b' }]);
      },
    } as unknown as Prisma.TransactionClient;

    const count = await lockActiveAdminRows(transaction);

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
