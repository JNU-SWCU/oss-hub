import type { PrismaService } from '../platform/prisma.service';
import { SystemStatusRepository } from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const repositoryWith = (
  streams: ReadonlyArray<{ streamType: string; status: string }>,
): SystemStatusRepository => {
  const statusGroups = [...new Set(streams.map((stream) => stream.status))].map(
    (status) => ({
      status,
      _count: {
        _all: streams.filter((stream) => stream.status === status).length,
      },
    }),
  );
  const prisma = {
    githubRepository: {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _max: { lastSuccessAt: null } }),
      findMany: jest.fn().mockResolvedValue([
        {
          githubRepositoryId: 1n,
          nameWithOwner: 'synthetic/repo',
          programId: null,
          streams: streams.map((stream) => ({
            ...stream,
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          })),
        },
      ]),
    },
    collectionRepositoryStream: {
      groupBy: jest.fn().mockResolvedValue(statusGroups),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _min: { lastRunAt: null, lastErrorAt: null },
        _max: { lastRunAt: null },
      }),
    },
    collectionSyncCursor: { findFirst: jest.fn().mockResolvedValue(null) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        hasStaffAccess: false,
        hasAdminAccess: true,
        accountStatus: 'ACTIVE',
      }),
    },
    repositoryProvisionJob: { count: jest.fn().mockResolvedValue(0) },
    collectionSweepHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
    },
  };
  return new SystemStatusRepository(prisma as unknown as PrismaService);
};

const threeReadyStreams = [
  { streamType: 'COMMIT', status: 'READY' },
  { streamType: 'PULL_REQUEST', status: 'READY' },
  { streamType: 'RELEASE', status: 'READY' },
];

const statusWith = (
  streams: ReadonlyArray<{ streamType: string; status: string }>,
) =>
  new SystemStatusService(repositoryWith(streams), () => new Date()).getStatus(
    1n,
  );

describe('SystemStatusService — stream 종류 (실제 repository)', () => {
  it('ISSUE 행이 아직 없는 저장소는 그 stream을 부분(PARTIAL)으로 센다', async () => {
    const { collection } = await statusWith(threeReadyStreams);

    expect(collection.readyStreamCount).toBe(3);
    expect(collection.partialStreamCount).toBe(1);
  });

  it('네 stream이 모두 READY면 부분으로 세는 stream이 없다', async () => {
    const { collection } = await statusWith([
      ...threeReadyStreams,
      { streamType: 'ISSUE', status: 'READY' },
    ]);

    expect(collection.readyStreamCount).toBe(4);
    expect(collection.partialStreamCount).toBe(0);
  });

  it('저장소별 상세에 ISSUE 칸을 함께 싣는다', async () => {
    const {
      collectionStreams: [repository],
    } = await statusWith(threeReadyStreams);

    expect(repository?.streams.map((stream) => stream.streamType)).toEqual([
      'COMMIT',
      'PULL_REQUEST',
      'RELEASE',
      'ISSUE',
    ]);
    expect(repository?.streams[3]?.bucket).toBe('PARTIAL');
  });
});
