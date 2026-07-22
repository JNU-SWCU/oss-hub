import {
  CollectionRunStatus,
  ObservationSourceType,
  Role,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProgramActivityService } from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';

const staff: ProgramViewer = {
  githubId: 1n,
  userId: 'staff-1',
  role: Role.STAFF,
};

function pushObservation(
  sourceId: string,
  repositoryId: number,
  size: number,
  createdAt: string,
) {
  return {
    sourceId,
    payload: {
      type: 'PushEvent',
      repo: { id: repositoryId, name: 'outside/same-name' },
      payload: { size },
      created_at: createdAt,
    },
  };
}

describe('ProgramActivityService', () => {
  it('성공한 run의 정확한 GitHub 저장소 이벤트를 sourceId별 한 번만 집계한다', async () => {
    // Given
    const repositoryFindMany = jest.fn().mockResolvedValue([
      {
        githubRepositoryId: 101n,
        application: {
          id: 'application-1',
          applicant: { githubId: 11n, name: '학생', login: 'student' },
          team: null,
        },
      },
    ]);
    const observationFindMany = jest
      .fn()
      .mockResolvedValue([
        pushObservation('event-1', 101, 2, '2026-07-20T00:00:00Z'),
        pushObservation('event-1', 101, 2, '2026-07-20T00:00:00Z'),
        pushObservation('event-2', 999, 7, '2026-07-21T00:00:00Z'),
      ]);
    const prisma = {
      repository: { findMany: repositoryFindMany },
      githubRawObservation: { findMany: observationFindMany },
    } as unknown as PrismaService;
    const service = new ProgramActivityService(prisma);

    // When
    const result = await service.activity('program-1', staff);

    // Then
    expect(result).toEqual([
      {
        applicationId: 'application-1',
        label: '학생',
        commitCount: 2,
        lastActivityAt: '2026-07-20T00:00:00Z',
      },
    ]);
    expect(repositoryFindMany).toHaveBeenCalledTimes(1);
    expect(observationFindMany).toHaveBeenCalledWith({
      where: {
        sourceType: ObservationSourceType.EVENT,
        run: {
          targetGithubId: { in: [11n] },
          status: CollectionRunStatus.SUCCEEDED,
        },
      },
      select: { sourceId: true, payload: true },
    });
  });
});
