import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type { GithubAppClient } from './github-app.client';
import { findOrCreateGithubRepository } from './repository-provision.github';

const names = {
  preferred: 'synthetic-program-team',
  collisionFallback: 'synthetic-program-team-applicat',
};

function githubMock(): jest.Mocked<
  Pick<GithubAppClient, 'findRepository' | 'createRepository'>
> {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string) =>
      Promise.resolve({
        githubRepositoryId: 987654321n,
        name,
        url: `https://github.com/synthetic-org/${name}`,
        visibility: 'PRIVATE' as const,
      }),
    ),
  };
}

describe('findOrCreateGithubRepository', () => {
  it('기본 이름 충돌 시 deterministic suffix로 한 번만 fallback한다', async () => {
    // Given: 기본 이름 생성이 422 충돌로 거절된다.
    const github = githubMock();
    github.createRepository.mockRejectedValueOnce(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );

    // When: 저장소 생성을 보장한다.
    const repository = await findOrCreateGithubRepository(github, names);

    // Then: application suffix 후보로 수렴한다.
    expect(repository.name).toBe(names.collisionFallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred],
      [names.collisionFallback],
    ]);
  });

  it('fallback 생성 직후 중단된 재시도는 기존 fallback을 이어 쓴다', async () => {
    // Given: 기본 이름은 충돌하고 fallback 저장소는 이미 존재한다.
    const github = githubMock();
    const fallback = {
      githubRepositoryId: 987654321n,
      name: names.collisionFallback,
      url: `https://github.com/synthetic-org/${names.collisionFallback}`,
      visibility: 'PRIVATE' as const,
    };
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fallback);
    github.createRepository.mockRejectedValueOnce(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      ),
    );

    // When: 저장소 생성을 다시 보장한다.
    const repository = await findOrCreateGithubRepository(github, names);

    // Then: fallback도 중복 생성하지 않는다.
    expect(repository).toEqual(fallback);
    expect(github.createRepository.mock.calls).toEqual([[names.preferred]]);
  });
});
