import { InvalidAuditLogMetadataError } from './history.error';
import type { AuditSourceRow } from './audit-entry.types';
import { auditRow, readRows } from './audit-log-mapping.fixture';

const occurredAt = new Date('2026-11-02T00:00:00.000Z');
const SELECTED_USER = {
  id: 'synthetic:type-selection-user',
  name: 'Selected User',
  login: 'selected-user',
  role: 'STUDENT',
};

function read(row: AuditSourceRow) {
  return readRows([row]);
}

function selectionRow(metadata: unknown): AuditSourceRow {
  return auditRow({
    id: 'user:synthetic-type-selection',
    actor: SELECTED_USER,
    targetPerson: {
      name: SELECTED_USER.name,
      login: SELECTED_USER.login,
      role: SELECTED_USER.role,
    },
    action: 'USER_ROLE_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic:type-selection-user',
    occurredAt,
    historyKind: 'TYPE_SELECTION',
    metadata,
  });
}

describe('TYPE_SELECTION audit display', () => {
  it.each([
    ['UNSELECTED', 'STUDENT'],
    ['STUDENT', 'STAFF'],
    ['STAFF', 'UNSELECTED'],
  ])(
    'preserves %s -> %s without inventing access snapshots',
    async (before, after) => {
      const result = await read(
        selectionRow({
          schemaVersion: 1,
          recordKind: 'TYPE_SELECTION',
          before,
          after,
          actor: { displayName: 'not a snapshot', githubLogin: 'must-not-win' },
        }),
      );

      expect(result.items[0]).toEqual({
        id: 'user:synthetic-type-selection',
        occurredAt,
        action: 'USER_ROLE_CHANGED',
        category: 'ACCOUNT',
        actor: SELECTED_USER,
        target: {
          type: 'USER',
          id: 'synthetic:type-selection-user',
          name: 'Selected User',
          login: 'selected-user',
          role: 'STUDENT',
          programName: null,
          teamName: null,
        },
        change: { field: 'userType', before, after },
        requestId: null,
        teamMembership: null,
        legacy: false,
        metadata: {
          schemaVersion: 1,
          recordKind: 'TYPE_SELECTION',
          before,
          after,
        },
      });
    },
  );

  it.each([
    { before: null, after: 'STUDENT' },
    { before: 'UNSELECTED', after: 'ADMIN' },
    { before: { role: 'STAFF' }, after: 'STUDENT' },
    { before: 'STUDENT' },
  ])('rejects invalid identity values %p', async (values) => {
    const row = selectionRow({
      schemaVersion: 1,
      recordKind: 'TYPE_SELECTION',
      ...values,
    });

    await expect(read(row)).rejects.toBeInstanceOf(
      InvalidAuditLogMetadataError,
    );
  });

  it('rejects unsupported selection versions', async () => {
    const row = selectionRow({
      schemaVersion: 2,
      recordKind: 'TYPE_SELECTION',
      before: 'UNSELECTED',
      after: 'STAFF',
    });

    await expect(read(row)).rejects.toBeInstanceOf(
      InvalidAuditLogMetadataError,
    );
  });
});
