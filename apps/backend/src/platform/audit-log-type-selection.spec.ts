import type { Prisma } from '@prisma/client';
import { AuditLogReadService } from './audit-log-read.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import type { AuditLogRow } from './audit-log.repository';

const reader = new AuditLogReadService(new AuditLogMetadataService());
const occurredAt = new Date('2026-11-02T00:00:00.000Z');

function selectionRow(metadata: Prisma.JsonValue): AuditLogRow {
  return {
    id: 'user:synthetic-type-selection',
    actor: { nickname: 'selected-user' },
    action: 'USER_ROLE_CHANGED',
    targetType: 'USER',
    targetId: 'synthetic:type-selection-user',
    occurredAt,
    historyKind: 'TYPE_SELECTION',
    legacySource: false,
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
    (before, after) => {
      const row = selectionRow({
        schemaVersion: 1,
        recordKind: 'TYPE_SELECTION',
        before,
        after,
        actor: { displayName: 'not a snapshot', githubLogin: 'must-not-win' },
      });

      const result = reader.record(row, reader.metadata(row), {
        programNameById: new Map(),
        repositoryFullNameById: new Map(),
        applicationLabelById: new Map(),
      });

      expect(result).toEqual({
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
  ])('rejects invalid identity values %p', (values) => {
    const row = selectionRow({
      schemaVersion: 1,
      recordKind: 'TYPE_SELECTION',
      ...values,
    });

    expect(() => reader.metadata(row)).toThrow(InvalidAuditLogMetadataError);
  });

  it('rejects unsupported selection versions', () => {
    const row = selectionRow({
      schemaVersion: 2,
      recordKind: 'TYPE_SELECTION',
      before: 'UNSELECTED',
      after: 'STAFF',
    });

    expect(() => reader.metadata(row)).toThrow(InvalidAuditLogMetadataError);
  });
});
