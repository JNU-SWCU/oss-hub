import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppClient,
  GithubRepositoryMetadata,
} from './github-app.client';
import {
  findOrCreateGithubRepository,
  parseOwnGithubRepositoryUrl,
  resolveOwnGithubRepository,
} from './repository-provision.github';
import { PROVISION_ERROR_CODES } from './repository-provision.failure';

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
  Pick<
    GithubAppClient,
    'findRepository' | 'createRepository' | 'findPublicRepository'
  >
> & { readonly organization: string } {
  return {
    organization: 'synthetic-org',
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string, description: string) =>
      Promise.resolve(metadata(name, description)),
    ),
    findPublicRepository: jest.fn().mockResolvedValue(null),
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

describe('parseOwnGithubRepositoryUrl', () => {
  it('https://github.com/{owner}/{name} 만 허용한다', () => {
    expect(
      parseOwnGithubRepositoryUrl(
        'https://github.com/synthetic-student/synthetic-repo',
      ),
    ).toEqual({ owner: 'synthetic-student', name: 'synthetic-repo' });
  });

  it.each([
    'http://github.com/synthetic-student/synthetic-repo',
    'https://gitlab.com/synthetic-student/synthetic-repo',
    'https://user@' + 'github.com/synthetic-student/synthetic-repo',
    'https://user:secret@' + 'github.com/synthetic-student/synthetic-repo',
    'https://github.com/synthetic-student/synthetic-repo.git',
    'https://github.com/synthetic-student/synthetic-repo/issues',
    'https://github.com/synthetic-student/synthetic-repo?tab=readme',
    'https://github.com/synthetic-student/synthetic-repo#readme',
    'not-a-url',
  ])('거부: %s', (url) => {
    expect(parseOwnGithubRepositoryUrl(url)).toBeNull();
  });
});

describe('resolveOwnGithubRepository', () => {
  it.each(['PRIVATE', 'PUBLIC'] as const)(
    '설정 조직의 %s 저장소는 App 접근 경로로 확인한다',
    async (visibility) => {
      const github = githubMock();
      const submittedUrl =
        'https://github.com/SYNTHETIC-ORG/submitted-repository';
      github.findRepository.mockResolvedValue({
        ...metadata('canonical-repository'),
        url: 'https://github.com/synthetic-org/canonical-repository',
        visibility,
      });

      const result = await resolveOwnGithubRepository(github, submittedUrl);

      expect(result).toEqual({
        kind: 'ORGANIZATION',
        repository: {
          ...metadata('canonical-repository'),
          name: 'submitted-repository',
          url: submittedUrl,
          visibility,
        },
      });
      expect(github.findRepository.mock.calls).toEqual([
        ['submitted-repository'],
      ]);
      expect(github.findPublicRepository).not.toHaveBeenCalled();
    },
  );

  it('설정 조직 저장소를 App으로 조회할 수 없으면 전용 최종 실패다', async () => {
    const github = githubMock();

    await expect(
      resolveOwnGithubRepository(
        github,
        'https://github.com/synthetic-org/inaccessible',
      ),
    ).rejects.toMatchObject({
      code: PROVISION_ERROR_CODES.OWN_ORGANIZATION_REPOSITORY_INACCESSIBLE,
      retryable: false,
    });
    expect(github.findPublicRepository).not.toHaveBeenCalled();
  });

  it('외부 공개 저장소를 조회하고 제출 URL과 canonical lookup identity를 함께 유지한다', async () => {
    const github = githubMock();
    const studentUrl = 'https://github.com/synthetic-student/synthetic-repo';
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: 42n,
      name: 'canonical-repo',
      nameWithOwner: 'transferred-owner/canonical-repo',
      url: 'https://github.com/transferred-owner/canonical-repo',
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });

    const repository = await resolveOwnGithubRepository(github, studentUrl);

    expect(github.findPublicRepository.mock.calls).toEqual([
      ['synthetic-student', 'synthetic-repo'],
    ]);
    expect(repository).toEqual({
      kind: 'EXTERNAL',
      repository: {
        githubRepositoryId: 42n,
        name: 'synthetic-repo',
        nameWithOwner: 'transferred-owner/canonical-repo',
        url: studentUrl,
        visibility: 'PUBLIC',
        archived: false,
        defaultBranch: 'main',
        description: null,
      },
    });
  });

  it.each([
    ['inaccessible', null],
    [
      'private visibility race',
      {
        githubRepositoryId: 43n,
        name: 'private-repository',
        nameWithOwner: 'synthetic-student/private-repository',
        url: 'https://github.com/synthetic-student/private-repository',
        visibility: 'PRIVATE' as const,
        archived: false,
        defaultBranch: 'main',
        description: null,
      },
    ],
  ])('외부 %s는 같은 안전한 최종 실패다', async (_case, resolved) => {
    const github = githubMock();
    github.findPublicRepository.mockResolvedValue(resolved);

    await expect(
      resolveOwnGithubRepository(
        github,
        'https://github.com/synthetic-student/private-or-missing',
      ),
    ).rejects.toMatchObject({
      code: PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
      retryable: false,
    });
  });

  it('이상한 URL이면 OWN_REPOSITORY_URL_INVALID 최종 실패', async () => {
    const github = githubMock();

    await expect(
      resolveOwnGithubRepository(github, 'https://example.com/not-github'),
    ).rejects.toMatchObject({
      code: PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
      retryable: false,
    });
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
  });
});
