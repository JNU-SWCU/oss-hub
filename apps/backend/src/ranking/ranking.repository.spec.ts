import { CollectionRunStatus, ObservationSourceType } from '@prisma/client';
import {
  RANKING_OBSERVATION_BATCH_SIZE,
  RankingRepository,
} from './ranking.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('RankingRepository', () => {
  it('platform repository id도 고정 크기 cursor page로 읽는다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: RANKING_OBSERVATION_BATCH_SIZE }, (_, index) => ({
          id: `repo-${String(index).padStart(4, '0')}`,
          githubRepositoryId: BigInt(index + 1),
        })),
      )
      .mockResolvedValueOnce([]);
    const prisma = { repository: { findMany } } as unknown as PrismaService;
    const repository = new RankingRepository(prisma);

    for await (const batch of repository.findPlatformRepositoryIdBatches()) {
      void batch;
    }

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: RANKING_OBSERVATION_BATCH_SIZE,
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: {
          id: `repo-${String(RANKING_OBSERVATION_BATCH_SIZE - 1).padStart(4, '0')}`,
        },
        skip: 1,
        take: RANKING_OBSERVATION_BATCH_SIZE,
      }),
    );
  });

  it('raw event를 고정 크기 cursor page로 읽고 올해 fetchedAt 하한을 적용한다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: RANKING_OBSERVATION_BATCH_SIZE }, (_, index) => ({
          id: `id-${String(index).padStart(4, '0')}`,
          sourceId: `event-${index}`,
          payload: {},
          run: {
            id: 'run-1',
            targetGithubId: 1n,
            targetLogin: 'mina',
            startedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        })),
      )
      .mockResolvedValueOnce([]);
    const prisma = {
      githubRawObservation: { findMany },
    } as unknown as PrismaService;
    const repository = new RankingRepository(prisma);
    const yearStart = new Date('2026-01-01T00:00:00.000Z');

    for await (const _batch of repository.findObservationBatches(yearStart)) {
      void _batch;
    }

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          sourceType: ObservationSourceType.EVENT,
          run: { status: CollectionRunStatus.SUCCEEDED },
          fetchedAt: { gte: yearStart },
        },
        take: RANKING_OBSERVATION_BATCH_SIZE,
        orderBy: [{ sourceId: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: {
          id: `id-${String(RANKING_OBSERVATION_BATCH_SIZE - 1).padStart(4, '0')}`,
        },
        skip: 1,
        take: RANKING_OBSERVATION_BATCH_SIZE,
      }),
    );
  });
});
