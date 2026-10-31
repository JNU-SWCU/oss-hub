import { RepositoryProvisionJobStatus, type Prisma } from '@prisma/client';
import {
  CollectionCutoverRepository,
  RepositoryProvisionJobRepository,
} from './repository-provision-job.repository';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.error';
import type { PrismaService } from '../platform/prisma.service';

describe('collection-cutover.repository', () => {
  const createDb = () => ({ $queryRawUnsafe: jest.fn() });
  const repositoryFor = (db: ReturnType<typeof createDb>) =>
    new CollectionCutoverRepository(db as unknown as PrismaService);

  describe('CollectionCutoverRepository quiescence', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');

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
});

const JOB_ID = 'synthetic-job';
const WORKER_ID = 'synthetic-worker';
const REQUEST_ID = 'synthetic-request-r1';

type RawRow = {
  readonly applicationId: string;
  readonly currentEventId: string | null;
  readonly repositoryId: string | null;
  readonly status: RepositoryProvisionJobStatus;
  readonly lockedBy: string | null;
};

function transaction(row: RawRow | null) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(row === null ? [] : [row]),
  } as unknown as Prisma.TransactionClient;
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    applicationId: 'synthetic-application',
    currentEventId: REQUEST_ID,
    repositoryId: 'synthetic-repository',
    status: RepositoryProvisionJobStatus.PROCESSING,
    lockedBy: WORKER_ID,
    ...overrides,
  };
}

describe('assertCurrentRequest', () => {
  it('같은 요청 세대와 lease면 잠근 job identity를 돌려준다', async () => {
    await expect(
      new RepositoryProvisionJobRepository({} as never).assertCurrentRequest(
        transaction(row()),
        JOB_ID,
        WORKER_ID,
        REQUEST_ID,
      ),
    ).resolves.toEqual({
      applicationId: 'synthetic-application',
      repositoryId: 'synthetic-repository',
    });
  });

  it('세대가 바뀌었으면 후속 lease 상태와 무관하게 옛 requestId로 superseded를 낸다', async () => {
    await expect(
      new RepositoryProvisionJobRepository({} as never).assertCurrentRequest(
        transaction(
          row({
            currentEventId: 'synthetic-request-r2',
            status: RepositoryProvisionJobStatus.PENDING,
            lockedBy: null,
          }),
        ),
        JOB_ID,
        WORKER_ID,
        REQUEST_ID,
      ),
    ).rejects.toMatchObject({
      name: 'RepositoryProvisionSupersededError',
      staleRequestId: REQUEST_ID,
    });
  });

  it('세대는 같지만 lease가 아니면 기존 lease-loss 의미를 유지한다', async () => {
    await expect(
      new RepositoryProvisionJobRepository({} as never).assertCurrentRequest(
        transaction(row({ lockedBy: 'other-worker' })),
        JOB_ID,
        WORKER_ID,
        REQUEST_ID,
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });
});
