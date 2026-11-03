import { AuditLogReadService } from './audit-log-read.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import type { AuditLogRow } from './audit-log.repository';

const reader = new AuditLogReadService(new AuditLogMetadataService());
const occurredAt = new Date('2026-11-02T00:00:00.000Z');

function bootstrapRow(action: string): AuditLogRow {
  return {
    id: 'seed:admin-history:transition',
    actor: null,
    action,
    targetType: 'USER',
    targetId: 'seed:subject',
    occurredAt,
    historyKind: 'BOOTSTRAP',
    legacySource: false,
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
    (action) => {
      const row = bootstrapRow(action);

      const record = reader.record(row, reader.metadata(row), {
        programNameById: new Map(),
        repositoryFullNameById: new Map(),
        applicationLabelById: new Map(),
      });

      expect(record).toEqual({
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
    (action) => {
      expect(() => reader.metadata(bootstrapRow(action))).toThrow(
        InvalidAuditLogMetadataError,
      );
    },
  );
});
