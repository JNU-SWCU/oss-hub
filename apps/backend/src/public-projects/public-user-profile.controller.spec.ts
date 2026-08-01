import type { PublicProjectRow } from './public-projects.repository';
import { PublicUserProfileController } from './public-user-profile.controller';
import type { PublicProjectsService } from './public-projects.service';

describe('PublicUserProfileController', () => {
  it('GET /:userId/profile — 서비스 결과를 프로필 응답 DTO로 매핑하며 userId를 그대로 전달한다', async () => {
    const project: PublicProjectRow = {
      id: 'synthetic-repository-1',
      githubRepositoryId: 9001n,
      repositoryName: 'synthetic-repo',
      githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
      publishedAt: new Date('2026-07-20T00:00:00.000Z'),
      programId: 'synthetic-program-1',
      programName: 'synthetic-program',
      category: 'BASIC',
      teamName: null,
      applicantNickname: 'synthetic-applicant',
    };
    const findProfile = jest.fn().mockResolvedValue({
      identity: {
        userId: 'synthetic-user-1',
        githubNickname: 'synthetic-login',
        avatarUrl: null,
      },
      projects: [project],
    });
    const controller = new PublicUserProfileController({
      findProfile,
    } as unknown as PublicProjectsService);

    const result = await controller.findProfile('synthetic-user-1');

    expect(findProfile).toHaveBeenCalledWith('synthetic-user-1');
    expect(result.userId).toBe('synthetic-user-1');
    expect(result.githubNickname).toBe('synthetic-login');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.projectId).toBe('synthetic-repository-1');
    const serialized = JSON.stringify(result);
    for (const forbidden of ['studentId', 'department', 'email', 'role']) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});
