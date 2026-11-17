import { InvalidAuditLogMetadataError } from './history.error';
import type { AuditSourceRow } from './audit-entry.types';
import { auditRow, readRows } from './audit-log-mapping.fixture';

const occurredAt = new Date('2026-11-02T00:00:00.000Z');

function bootstrapRow(action: string): AuditSourceRow {
  return auditRow({
    id: 'seed:admin-history:transition',
    action,
    targetType: 'USER',
    targetId: 'seed:subject',
    occurredAt,
    historyKind: 'BOOTSTRAP',
    category: 'SYSTEM',
    metadata: {
      schemaVersion: 1,
      recordKind: 'BOOTSTRAP',
      operatorReceipt: 'private operator receipt',
      action: 'UNTRUSTED_PAYLOAD_ACTION',
    },
  });
}

describe('Bootstrap audit reader', () => {
  it.each(['GRANT_ADMIN_ACCESS', 'REVOKE_ADMIN_ACCESS'])(
    'retains projected %s without exposing the receipt or inventing an actor',
    async (action) => {
      const result = await readRows([bootstrapRow(action)]);

      expect(result.items[0]).toEqual({
        id: 'seed:admin-history:transition',
        occurredAt,
        action,
        category: 'SYSTEM',
        actor: null,
        target: {
          type: 'USER',
          id: 'seed:subject',
          name: null,
          login: null,
          role: null,
          programName: null,
          teamName: null,
        },
        change: null,
        requestId: null,
        teamMembership: null,
        legacy: false,
        metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
      });
    },
  );

  it.each(['TYPE_CHANGED', 'SIGNED_UP', 'UNKNOWN'])(
    'rejects unsupported bootstrap event projection %s instead of treating it as a grant',
    async (action) => {
      await expect(readRows([bootstrapRow(action)])).rejects.toBeInstanceOf(
        InvalidAuditLogMetadataError,
      );
    },
  );
});
