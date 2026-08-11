import { CollectionCutoverRepository } from './collection-cutover.repository';
import type { PrismaService } from '../../prisma/prisma.service';

interface MockDb {
  collectionRepositoryStream: { count: jest.Mock };
  collectionCommitFact: { count: jest.Mock };
  collectionPullRequestFact: { count: jest.Mock };
  collectionReleaseFact: { count: jest.Mock };
  $queryRaw: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
}

const createDb = (): MockDb => ({
  collectionRepositoryStream: { count: jest.fn().mockResolvedValue(0) },
  collectionCommitFact: { count: jest.fn().mockResolvedValue(0) },
  collectionPullRequestFact: { count: jest.fn().mockResolvedValue(0) },
  collectionReleaseFact: { count: jest.fn().mockResolvedValue(0) },
  $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
});

const repositoryFor = (db: MockDb): CollectionCutoverRepository =>
  new CollectionCutoverRepository(db as unknown as PrismaService);

describe('CollectionCutoverRepository — todo 14 quiesce lease (epoch fencing)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const expiresAt = new Date('2026-08-01T04:00:00.000Z');

  it('acquireLease는 만료된(또는 없는) lease만 훔치고, 살아있으면 null을 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([
      {
        appId: 1n,
        scope: 'org:jnu-swcu',
        ownerId: 'owner-1',
        epoch: 1n,
        runId: 'run-1',
        expiresAt,
      },
    ]);

    const token = await repositoryFor(db).acquireLease({
      appId: 1n,
      scope: 'org:jnu-swcu',
      ownerId: 'owner-1',
      runId: 'run-1',
      now,
      expiresAt,
    });

    expect(token?.runId).toBe('run-1');
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "CollectionCutoverLease"'),
      1n,
      'org:jnu-swcu',
      'owner-1',
      expiresAt,
      'run-1',
      now,
    );
  });

  it('acquireLease는 아무 행도 반환되지 않으면(살아있는 lease) null을 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([]);

    const token = await repositoryFor(db).acquireLease({
      appId: 1n,
      scope: 'org:jnu-swcu',
      ownerId: 'owner-1',
      runId: 'run-1',
      now,
      expiresAt,
    });

    expect(token).toBeNull();
  });

  it('releaseLease는 best-effort로 조건에 맞는 lease만 만료시킨다', async () => {
    const db = createDb();
    db.$executeRawUnsafe.mockResolvedValue(1);

    await repositoryFor(db).releaseLease(
      {
        appId: 1n,
        scope: 'org:jnu-swcu',
        ownerId: 'owner-1',
        epoch: 1n,
        runId: 'run-1',
        expiresAt,
      },
      now,
    );

    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "CollectionCutoverLease"'),
      1n,
      'org:jnu-swcu',
      'owner-1',
      1n,
      'run-1',
      now,
    );
  });

  it('isQuiesced는 살아있는 lease가 있으면 true를 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ quiesced: true }]);

    await expect(repositoryFor(db).isQuiesced(now)).resolves.toBe(true);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT EXISTS'),
      now,
    );
  });

  it('isQuiesced는 살아있는 lease가 없으면 false를 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ quiesced: false }]);

    await expect(repositoryFor(db).isQuiesced(now)).resolves.toBe(false);
  });
});

describe('CollectionCutoverRepository — aggregate 비교 보조 조회', () => {
  it('countVerifyingStreams는 VERIFYING 상태 stream 개수만 센다', async () => {
    const db = createDb();
    db.collectionRepositoryStream.count.mockResolvedValue(3);

    await expect(repositoryFor(db).countVerifyingStreams()).resolves.toBe(3);
    expect(db.collectionRepositoryStream.count).toHaveBeenCalledWith({
      where: { status: 'VERIFYING' },
    });
  });

  it('countCommitFactsForRepositories는 빈 배열이면 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).countCommitFactsForRepositories([], new Set([1n])),
    ).resolves.toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('countCommitFactsForRepositories는 cutover 시작 때 고정한 가입자 fact만 센다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([{ count: 5n }]);

    await expect(
      repositoryFor(db).countCommitFactsForRepositories(
        ['repo-1', 'repo-2'],
        new Set([1n, 2n]),
      ),
    ).resolves.toBe(5);
    const [sql, repositoryIds, registeredGithubIds] = db.$queryRaw.mock
      .calls[0] as [readonly string[], readonly string[], readonly bigint[]];
    expect(sql.join('')).not.toContain('JOIN "User"');
    expect(sql.join('')).toContain('f."authorGithubId" = ANY(');
    expect(repositoryIds).toEqual(['repo-1', 'repo-2']);
    expect(registeredGithubIds).toEqual([1n, 2n]);
  });

  it('가입자 snapshot이 비었으면 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).countCommitFactsForRepositories(['repo-1'], new Set()),
    ).resolves.toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('countPullRequestFactsForRepositories는 빈 배열이면 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).countPullRequestFactsForRepositories([], new Set([1n])),
    ).resolves.toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('countReleaseFactsForRepositories는 빈 배열이면 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).countReleaseFactsForRepositories([], new Set([1n])),
    ).resolves.toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
