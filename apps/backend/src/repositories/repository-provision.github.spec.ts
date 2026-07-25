import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppClient,
  GithubRepositoryMetadata,
} from './github-app.client';
import { findOrCreateGithubRepository } from './repository-provision.github';

const names = {
  preferred: 'synthetic-program-team',
  collisionFallback: 'synthetic-program-team-applicat',
};
const OWNERSHIP_MARKER = `oss-hub:${'a'.repeat(64)}`;

function metadata(
  name: string,
  description: string | null = OWNERSHIP_MARKER,
): GithubRepositoryMetadata {
  return {
    githubRepositoryId: 987654321n,
    name,
    url: `https://github.com/synthetic-org/${name}`,
    visibility: 'PRIVATE',
    description,
  };
}

function githubMock(): jest.Mocked<
  Pick<GithubAppClient, 'findRepository' | 'createRepository'>
> {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string, description: string) =>
      Promise.resolve(metadata(name, description)),
    ),
  };
}

function nameCollision(): GithubOperationsError {
  return new GithubOperationsError(
    GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
    false,
  );
}

describe('findOrCreateGithubRepository', () => {
  it('소유 marker를 가진 private 저장소를 생성한다', async () => {
    // Given: 같은 이름의 저장소가 없다.
    const github = githubMock();

    // When: 저장소 생성을 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: application 소유 marker와 private 생성 결과를 검증한다.
    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('같은 marker의 기본 저장소만 중단된 작업으로 이어 쓴다', async () => {
    // Given: 이전 시도에서 소유 marker를 기록한 저장소가 생성됐다.
    const github = githubMock();
    github.findRepository.mockResolvedValue(metadata(names.preferred));

    // When: 저장소 생성을 다시 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: 같은 application의 저장소만 재사용한다.
    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository).not.toHaveBeenCalled();
  });

  it('동명 기본 저장소의 marker가 다르면 deterministic suffix를 쓴다', async () => {
    // Given: 기본 이름은 다른 작업이 소유한다.
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(null);

    // When: 저장소 생성을 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: 무관한 저장소를 연결하지 않고 suffix 후보를 생성한다.
    expect(repository.name).toBe(names.collisionFallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.collisionFallback, OWNERSHIP_MARKER],
    ]);
  });

  it('기본 이름 생성 경쟁에서 같은 marker가 확인되면 그 저장소를 쓴다', async () => {
    // Given: 조회 직후 같은 작업이 기본 저장소 생성을 먼저 마쳤다.
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred));
    github.createRepository.mockRejectedValueOnce(nameCollision());

    // When: 저장소 생성을 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: 동일 marker를 재확인하고 중복 저장소를 만들지 않는다.
    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('기본 이름 충돌이 다른 저장소면 deterministic suffix로 수렴한다', async () => {
    // Given: 기본 이름 생성이 충돌하고 그 이름은 다른 작업이 소유한다.
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(null);
    github.createRepository.mockRejectedValueOnce(nameCollision());

    // When: 저장소 생성을 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: application suffix 후보로 한 번만 fallback한다.
    expect(repository.name).toBe(names.collisionFallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
      [names.collisionFallback, OWNERSHIP_MARKER],
    ]);
  });

  it('fallback 생성 직후 중단된 재시도는 같은 marker만 이어 쓴다', async () => {
    // Given: 기본 이름은 충돌하고 fallback 저장소는 이미 존재한다.
    const github = githubMock();
    const fallback = metadata(names.collisionFallback);
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(fallback);
    github.createRepository.mockRejectedValueOnce(nameCollision());

    // When: 저장소 생성을 다시 보장한다.
    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: fallback도 중복 생성하지 않는다.
    expect(repository).toEqual(fallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('fallback 이름도 다른 저장소가 소유하면 최종 실패한다', async () => {
    // Given: 기본과 fallback 이름 모두 다른 작업이 소유한다.
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(metadata(names.collisionFallback, null));

    // When: 저장소 생성을 보장한다.
    const repository = findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    // Then: 무관한 저장소를 연결하거나 무한 후보를 만들지 않는다.
    await expect(repository).rejects.toEqual(nameCollision());
    expect(github.createRepository).not.toHaveBeenCalled();
  });
});
