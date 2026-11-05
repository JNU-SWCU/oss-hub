import type { AuditLogRow } from './audit-log-read.repository';
import { AuditLogReadService } from './audit-log-read.service';

import {
  occurredAt,
  state,
  people,
  lifecycle,
  visibility,
  decision,
  cases,
} from './audit-log-mapping.fixture';

const JOINED_TARGETS: Readonly<Record<string, string>> = {
  PROGRAM: 'Current program',
  REPOSITORY: 'current/repo',
  APPLICATION: 'Current application program',
};

function row(
  metadata: unknown,
  targetType = 'USER',
  joinedTarget: string | null = JOINED_TARGETS[targetType] ?? null,
): AuditLogRow {
  return {
    id: 'audit-1',
    actor: { nickname: 'renamed-actor' },
    action: 'SYNTHETIC',
    targetType,
    targetId: 'target',
    metadata,
    historyKind: null,
    joinedTarget,
    occurredAt,
  };
}

function read(rows: readonly AuditLogRow[]) {
  return new AuditLogReadService({
    list: () => Promise.resolve({ rows, total: rows.length }),
  }).list({ page: 1, limit: 20 });
}

describe('AuditLogReadService record mapping', () => {
  it.each(cases)(
    'renders $name',
    async ({ targetType, metadata, expectedTarget }) => {
      const result = await read([row(metadata, targetType)]);

      expect(result.items[0]?.target).toBe(expectedTarget);
    },
  );

  it.each(['PROGRAM', 'REPOSITORY', 'APPLICATION'])(
    'uses the original %s id when a live target no longer exists',
    async (targetType) => {
      const result = await read([row({}, targetType, null)]);

      expect(result.items[0]?.target).toBe(targetType + ' / target');
    },
  );

  it('uses event-time people instead of renamed live users', async () => {
    const metadata = {
      schemaVersion: 2,
      eventKind: 'DIRECT_ROLE_CHANGED',
      ...people,
      before: state,
      after: state,
    };

    const result = await read([row(metadata)]);

    expect(result.items[0]).toMatchObject({
      actor: 'Original actor',
      actorHandle: 'old-actor',
      target: 'Original target',
      targetHandle: 'old-target',
      metadata,
      legacy: false,
    });
  });

  it('does not invent an actor for system histories', async () => {
    const result = await read([
      {
        ...row({ schemaVersion: 1, recordKind: 'BOOTSTRAP' }),
        action: 'GRANT_ADMIN_ACCESS',
        actor: null,
        historyKind: 'BOOTSTRAP',
      },
    ]);

    expect(result.items[0]).toMatchObject({
      actor: 'SYSTEM',
      actorHandle: null,
      targetHandle: null,
    });
  });

  it('prefers the original snapshot over live names when an event contains one', async () => {
    const result = await read([
      row(
        { schemaVersion: 2, programName: 'Original program', ...lifecycle },
        'PROGRAM',
      ),
      row(
        {
          schemaVersion: 2,
          repositoryId: 'target',
          repositoryFullName: 'original/repo',
          ...visibility,
        },
        'REPOSITORY',
      ),
      row(
        {
          schemaVersion: 2,
          programName: 'Original program',
          applicantGithubLogin: 'original-applicant',
          ...decision,
        },
        'APPLICATION',
      ),
    ]);

    expect(result.items.map((item) => item.target)).toEqual([
      'Original program',
      'original/repo',
      'Original program · @original-applicant',
    ]);
  });

  it('labels legacy rows with the joined live name and no metadata', async () => {
    const result = await read(
      ['PROGRAM', 'PROGRAM', 'REPOSITORY', 'APPLICATION'].map((type) =>
        row({}, type),
      ),
    );

    expect(result.items.map((item) => item.target)).toEqual([
      'Current program',
      'Current program',
      'current/repo',
      'Current application program',
    ]);
    expect(result.items.map((item) => item.metadata)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('keeps stored metadata for display and rejects it for an invalid phone transition', async () => {
    const stored = { schemaVersion: 1, transition: 'SET' };

    const result = await read([
      { ...row(stored), action: 'USER_PHONE_UPDATED' },
      {
        ...row({ schemaVersion: 1, transition: 'UNKNOWN' }),
        action: 'USER_PHONE_UPDATED',
      },
    ]);

    expect(result.items.map((item) => [item.legacy, item.metadata])).toEqual([
      [false, stored],
      [true, null],
    ]);
  });
});
