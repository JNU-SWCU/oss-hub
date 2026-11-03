import type { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { AuditLogMetadataService } from './audit-log-metadata.service';
import { AuditLogReadService } from './audit-log-read.service';
import type { AuditLogRepository, AuditLogRow } from './audit-log.repository';

import {
  occurredAt,
  state,
  people,
  lifecycle,
  visibility,
  decision,
  cases,
} from './audit-log-mapping.fixture';

function createRepository(rows: readonly AuditLogRow[]) {
  return {
    list: jest.fn().mockResolvedValue({ rows, total: rows.length }),
    record: jest.fn(),
    findProgramNames: jest
      .fn()
      .mockResolvedValue([{ id: 'target', name: 'Current program' }]),
    findRepositoryNames: jest
      .fn()
      .mockResolvedValue([{ id: 'target', nameWithOwner: 'current/repo' }]),
    findApplicationProgramNames: jest.fn().mockResolvedValue([
      {
        id: 'target',
        program: { name: 'Current application program' },
        applicant: { nickname: 'must-not-leak' },
      },
    ]),
  } satisfies Pick<
    AuditLogRepository,
    | 'list'
    | 'record'
    | 'findProgramNames'
    | 'findRepositoryNames'
    | 'findApplicationProgramNames'
  >;
}

function row(metadata: Prisma.JsonValue, targetType = 'USER'): AuditLogRow {
  return {
    id: 'audit-1',
    actor: { nickname: 'renamed-actor' },
    action: 'SYNTHETIC',
    targetType,
    targetId: 'target',
    metadata,
    occurredAt,
  };
}

function service(
  repository: ReturnType<typeof createRepository>,
): AuditLogService {
  return new AuditLogService(
    repository,
    new AuditLogReadService(new AuditLogMetadataService()),
  );
}

describe('AuditLogService record mapping', () => {
  it.each(cases)(
    'renders $name',
    async ({ targetType, metadata, expectedTarget }) => {
      const repository = createRepository([row(metadata, targetType)]);

      const result = await service(repository).list({ page: 1, limit: 20 });

      expect(result.items[0]?.target).toBe(expectedTarget);
    },
  );

  it.each(['PROGRAM', 'REPOSITORY', 'APPLICATION'])(
    'uses the original %s id when a live target no longer exists',
    async (targetType) => {
      const repository = createRepository([row({}, targetType)]);
      repository.findProgramNames.mockResolvedValue([]);
      repository.findRepositoryNames.mockResolvedValue([]);
      repository.findApplicationProgramNames.mockResolvedValue([]);

      const result = await service(repository).list({ page: 1, limit: 20 });

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

    const result = await service(createRepository([row(metadata)])).list({
      page: 1,
      limit: 20,
    });

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
    const repository = createRepository([
      {
        ...row({ schemaVersion: 1, recordKind: 'BOOTSTRAP' }),
        action: 'GRANT_ADMIN_ACCESS',
        actor: null,
        historyKind: 'BOOTSTRAP',
      },
    ]);

    const result = await service(repository).list({ page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      actor: 'SYSTEM',
      actorHandle: null,
      targetHandle: null,
    });
  });

  it('does not query live names when each event contains its original snapshot', async () => {
    const repository = createRepository([
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

    const result = await service(repository).list({ page: 1, limit: 20 });

    expect(result.items.map((item) => item.target)).toEqual([
      'Original program',
      'original/repo',
      'Original program · @original-applicant',
    ]);
    expect(repository.findProgramNames).not.toHaveBeenCalled();
    expect(repository.findRepositoryNames).not.toHaveBeenCalled();
    expect(repository.findApplicationProgramNames).not.toHaveBeenCalled();
  });

  it('batches legacy name lookups once per target family without leaking applicant handles', async () => {
    const repository = createRepository(
      ['PROGRAM', 'PROGRAM', 'REPOSITORY', 'APPLICATION'].map((type) =>
        row({}, type),
      ),
    );

    const result = await service(repository).list({ page: 1, limit: 20 });

    expect(result.items.map((item) => item.target)).toEqual([
      'Current program',
      'Current program',
      'current/repo',
      'Current application program',
    ]);
    expect(repository.findProgramNames).toHaveBeenCalledTimes(1);
    expect(repository.findRepositoryNames).toHaveBeenCalledTimes(1);
    expect(repository.findApplicationProgramNames).toHaveBeenCalledTimes(1);
  });
});
