import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { PublicProjectRow } from './public-projects.repository';
import { PublicUserProfileController } from './public-user-profile.controller';
import type { PublicProjectsService } from './public-projects.service';

describe('PublicUserProfileController', () => {
  it('공개 프로필은 저장소 공개 회수 뒤 이전 응답을 cache하지 않는다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      PublicUserProfileController.prototype,
      'findProfile',
    )?.value;
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(HEADERS_METADATA, handler as object)).toBe(
      undefined,
    );
  });

  it('GET /:userId/public-profile — 서비스 결과를 프로필 응답 DTO로 매핑하며 userId를 그대로 전달한다', async () => {
    const project: PublicProjectRow = {
      id: 'synthetic-repository-1',
      projectId: '9001',
      githubRepositoryId: 9001n,
      repositoryName: 'synthetic-repo',
      githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
      publishedAt: new Date('2026-07-20T00:00:00.000Z'),
      programId: 'synthetic-program-1',
      programName: 'synthetic-program',
      category: 'BASIC',
      teamName: null,
      teamMemberCount: 1,
      applicantNickname: 'synthetic-applicant',
    };
    const findProfile = jest.fn().mockResolvedValue({
      identity: {
        userId: 'synthetic-user-1',
        githubNickname: 'synthetic-login',
        avatarUrl: null,
        githubId: 501n,
      },
      projects: [
        {
          row: project,
          observed: true,
          dataAsOf: new Date('2026-07-30T00:00:00.000Z'),
          metrics: { commitCount: 5, pullRequestCount: 1, releaseCount: 0 },
        },
      ],
      observedTotals: { commitCount: 5, pullRequestCount: 1, releaseCount: 0 },
    });
    const controller = new PublicUserProfileController({
      findProfile,
    } as unknown as PublicProjectsService);

    const result = await controller.findProfile('synthetic-user-1');

    expect(findProfile).toHaveBeenCalledWith('synthetic-user-1');
    expect(result.userId).toBe('synthetic-user-1');
    expect(result.githubNickname).toBe('synthetic-login');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.projectId).toBe('9001');
    expect(result.projects[0]?.observed).toBe(true);
    expect(result.projects[0]?.metrics).toEqual({
      commitCount: 5,
      pullRequestCount: 1,
      releaseCount: 0,
    });
    expect(result.observedTotals).toEqual({
      commitCount: 5,
      pullRequestCount: 1,
      releaseCount: 0,
    });
    const serialized = JSON.stringify(result);
    // githubId는 내부 매칭 키일 뿐 응답에 노출되지 않는다.
    expect(serialized).not.toContain('501');
    for (const forbidden of ['studentId', 'department', 'email', 'role']) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});
