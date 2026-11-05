import { AuditLogReadService } from './audit-log-read.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import type { AuditLogRow } from './audit-log-read.repository';

const occurredAt = new Date('2026-11-02T00:00:00.000Z');

function read(row: AuditLogRow) {
  return new AuditLogReadService({
    list: () => Promise.resolve({ rows: [row], total: 1 }),
  }).list({ page: 1, limit: 20 });
}

function selectionRow(metadata: unknown): AuditLogRow {
  return {
    id: 'user:synthetic-type-selection',
    actor: { nickname: 'selected-user' },
    action: 'USER_ROLE_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic:type-selection-user',
    occurredAt,
    historyKind: 'TYPE_SELECTION',
    joinedTarget: null,
    metadata,
  };
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
        actor: 'selected-user',
        actorHandle: 'selected-user',
        action: 'USER_ROLE_CHANGED',
        targetType: 'USER',
        targetId: 'synthetic:type-selection-user',
        target: 'USER / synthetic:type-selection-user',
        targetHandle: null,
        occurredAt,
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
