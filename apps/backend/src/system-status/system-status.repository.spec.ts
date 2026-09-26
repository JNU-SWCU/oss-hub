import type { PrismaService } from '../prisma/prisma.service';
import { SystemStatusRepository } from './system-status.repository';

/**
 * ISSUE stream(#1133)이 생긴 뒤에도 진행 집계가 stream 종류 수를 따라가는지 본다.
 * 종류 수를 3으로 고정해 두면 ISSUE 행이 아직 없는 저장소가 부분(PARTIAL)으로 잡히지 않는다.
 */
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
  };
  return new SystemStatusRepository(prisma as unknown as PrismaService);
};

const threeReadyStreams = [
  { streamType: 'COMMIT', status: 'READY' },
  { streamType: 'PULL_REQUEST', status: 'READY' },
  { streamType: 'RELEASE', status: 'READY' },
];

describe('SystemStatusRepository — stream 종류', () => {
  it('ISSUE 행이 아직 없는 저장소는 그 stream을 부분(PARTIAL)으로 센다', async () => {
    const snapshot =
      await repositoryWith(threeReadyStreams).getIncrementalStatusSnapshot();

    expect(snapshot.readyStreamCount).toBe(3);
    expect(snapshot.partialStreamCount).toBe(1);
  });

  it('네 stream이 모두 READY면 부분으로 세는 stream이 없다', async () => {
    const snapshot = await repositoryWith([
      ...threeReadyStreams,
      { streamType: 'ISSUE', status: 'READY' },
    ]).getIncrementalStatusSnapshot();

    expect(snapshot.readyStreamCount).toBe(4);
    expect(snapshot.partialStreamCount).toBe(0);
  });

  it('저장소별 상세에 ISSUE 칸을 함께 싣는다', async () => {
    const [repository] =
      await repositoryWith(threeReadyStreams).getIncrementalStatusStreams();

    expect(repository?.streams.map((stream) => stream.streamType)).toEqual([
      'COMMIT',
      'PULL_REQUEST',
      'RELEASE',
      'ISSUE',
    ]);
    expect(repository?.streams[3]?.bucket).toBe('PARTIAL');
  });
});
