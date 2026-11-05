import { AuditLogReadService } from './audit-log-read.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import type { AuditLogRow } from './audit-log-read.repository';

const occurredAt = new Date('2026-11-02T00:00:00.000Z');

function read(row: AuditLogRow) {
  return new AuditLogReadService({
    list: () => Promise.resolve({ rows: [row], total: 1 }),
  }).list({ page: 1, limit: 20 });
}

function bootstrapRow(action: string): AuditLogRow {
  return {
    id: 'seed:admin-history:transition',
    actor: null,
    action,
    targetType: 'USER',
    targetId: 'seed:subject',
    occurredAt,
    historyKind: 'BOOTSTRAP',
    joinedTarget: null,
    metadata: {
      schemaVersion: 1,
      recordKind: 'BOOTSTRAP',
      operatorReceipt: 'private operator receipt',
      action: 'UNTRUSTED_PAYLOAD_ACTION',
    },
  };
}

describe('Bootstrap audit reader', () => {
  it.each(['GRANT_ADMIN_ACCESS', 'REVOKE_ADMIN_ACCESS'])(
    'retains projected %s without exposing the receipt or inventing an actor',
    async (action) => {
      const result = await read(bootstrapRow(action));

      expect(result.items[0]).toEqual({
        id: 'seed:admin-history:transition',
        actor: 'SYSTEM',
        actorHandle: null,
        action,
        targetType: 'USER',
        targetId: 'seed:subject',
        target: 'USER / seed:subject',
        targetHandle: null,
        occurredAt,
        legacy: false,
        metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
      });
    },
  );

  it.each(['TYPE_CHANGED', 'SIGNED_UP', 'UNKNOWN'])(
    'rejects unsupported bootstrap event projection %s instead of treating it as a grant',
    async (action) => {
      await expect(read(bootstrapRow(action))).rejects.toBeInstanceOf(
        InvalidAuditLogMetadataError,
      );
    },
  );
});
