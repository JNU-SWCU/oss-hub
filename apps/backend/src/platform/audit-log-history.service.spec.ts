import type { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { AuditLogReadService } from './audit-log-read.service';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';

function serviceFor(
  metadata: Prisma.JsonValue,
  legacySource = false,
  historyKind?: string,
) {
  return new AuditLogService(
    {
      list: () =>
        Promise.resolve({
          total: 1,
          rows: [
            {
              id: 'original-audit',
              actor: { nickname: 'renamed-actor' },
              action:
                historyKind === 'BOOTSTRAP'
                  ? 'GRANT_ADMIN_ACCESS'
                  : 'USER_PROFILE_UPDATED',
              targetType: 'USER',
              targetId: 'missing-user',
              occurredAt: new Date('2026-11-01T00:00:00.000Z'),
              metadata,
              legacySource,
              ...(historyKind === undefined ? {} : { historyKind }),
            },
          ],
        }),
      record: jest.fn(),
      findProgramNames: jest.fn().mockResolvedValue([]),
      findRepositoryNames: jest.fn().mockResolvedValue([]),
      findApplicationProgramNames: jest.fn().mockResolvedValue([]),
    },
    new AuditLogReadService(new AuditLogMetadataService()),
  );
}

describe('Owned history display', () => {
  it.each([null, ['unrecognized'], { schemaVersion: 19, phone: 'private' }])(
    'keeps malformed imported or unresolved metadata %p visible without leaking raw data',
    async (metadata) => {
      const result = await serviceFor(metadata, true).list({
        page: 1,
        limit: 20,
      });

      expect(result.items).toEqual([
        {
          id: 'original-audit',
          actor: 'renamed-actor',
          actorHandle: 'renamed-actor',
          action: 'USER_PROFILE_UPDATED',
          targetType: 'USER',
          targetId: 'missing-user',
          target: 'USER / missing-user',
          targetHandle: null,
          occurredAt: new Date('2026-11-01T00:00:00.000Z'),
          legacy: true,
          metadata: null,
        },
      ]);
    },
  );

  it('still rejects malformed current domain metadata', async () => {
    await expect(
      serviceFor({ schemaVersion: 19 }).list({ page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(InvalidAuditLogMetadataError);
  });

  it('preserves event-time people snapshots on imported metadata', async () => {
    const metadata = {
      schemaVersion: 1,
      actor: { displayName: 'Original actor', githubLogin: 'old-actor' },
      target: { displayName: 'Original target', githubLogin: 'old-target' },
      changes: [{ field: 'name', before: 'Before', after: 'After' }],
    };

    const result = await serviceFor(metadata, true).list({
      page: 1,
      limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      actor: 'Original actor',
      actorHandle: 'old-actor',
      target: 'Original target',
      targetHandle: 'old-target',
      legacy: false,
      metadata,
    });
  });

  it('displays real request transitions without exposing decision reason or fabricating access snapshots', async () => {
    const result = await serviceFor(
      {
        schemaVersion: 1,
        recordKind: 'REQUEST_TRANSITION',
        request: {
          id: 'request-old',
          userId: 'target',
          status: 'REVOKED',
          createdAt: '2026-10-01T00:00:00.000Z',
          decidedAt: '2026-11-01T00:00:00.000Z',
          decidedById: 'actor',
          rejectionReason: 'private decision',
        },
        cause: 'SUPERSEDED',
        replacementRequestId: 'request-new',
      },
      false,
      'REQUEST_TRANSITION',
    ).list({ page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      legacy: false,
      metadata: {
        schemaVersion: 1,
        recordKind: 'REQUEST_TRANSITION',
        requestId: 'request-old',
        status: 'REVOKED',
        cause: 'SUPERSEDED',
        replacementRequestId: 'request-new',
      },
    });
    expect(result.items[0]?.metadata).not.toHaveProperty('request');
    expect(result.items[0]?.metadata).not.toHaveProperty('actor');
  });

  it.each(['SIGNUP', 'BOOTSTRAP'])(
    'exposes the typed %s event without operator receipts',
    async (recordKind) => {
      const result = await serviceFor(
        {
          schemaVersion: 1,
          recordKind,
          operatorReceipt: 'private receipt',
        },
        false,
        recordKind,
      ).list({ page: 1, limit: 20 });

      expect(result.items[0]?.metadata).toEqual({
        schemaVersion: 1,
        recordKind,
      });
      expect(result.items[0]?.legacy).toBe(false);
    },
  );

  it.each([
    { schemaVersion: 2, recordKind: 'SIGNUP' },
    { schemaVersion: 1, recordKind: 'REQUEST_SNAPSHOT' },
    {
      schemaVersion: 1,
      recordKind: 'REQUEST_TRANSITION',
      request: { id: 'r', status: 'UNKNOWN' },
    },
  ])('rejects unsupported runtime envelope %p', async (metadata) => {
    await expect(
      serviceFor(metadata, false, metadata.recordKind).list({
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(InvalidAuditLogMetadataError);
  });

  it('does not reinterpret old raw metadata as a new domain event', async () => {
    const result = await serviceFor(
      {
        schemaVersion: 1,
        recordKind: 'BOOTSTRAP',
      },
      true,
    ).list({ page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({ legacy: true, metadata: null });
  });
});
