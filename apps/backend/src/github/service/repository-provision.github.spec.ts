import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../domain/github-app.error';
import type { GithubAppClient } from '../gateway/github-app.client';
import type { GithubRepositoryMetadata } from '../domain/github-app.response';
import {
  findOrCreateGithubRepository,
  resolveOwnGithubRepository,
} from './repository-provision.github';
import { PROVISION_ERROR_CODES } from '../domain/repository-provision.failure';
import { parseGithubRepositoryUrl } from '../domain/github-repository-url';

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
    nameWithOwner: `synthetic-org/${name}`,
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
    const github = githubMock();

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('같은 marker의 기본 저장소만 중단된 작업으로 이어 쓴다', async () => {
    const github = githubMock();
    github.findRepository.mockResolvedValue(metadata(names.preferred));

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository).not.toHaveBeenCalled();
  });

  it('동명 기본 저장소의 marker가 다르면 deterministic suffix를 쓴다', async () => {
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(null);

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository.name).toBe(names.collisionFallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.collisionFallback, OWNERSHIP_MARKER],
    ]);
  });

  it('기본 이름 생성 경쟁에서 같은 marker가 확인되면 그 저장소를 쓴다', async () => {
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred));
    github.createRepository.mockRejectedValueOnce(nameCollision());

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository).toEqual(metadata(names.preferred));
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('기본 이름 충돌이 다른 저장소면 deterministic suffix로 수렴한다', async () => {
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(null);
    github.createRepository.mockRejectedValueOnce(nameCollision());

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository.name).toBe(names.collisionFallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
      [names.collisionFallback, OWNERSHIP_MARKER],
    ]);
  });

  it('fallback 생성 직후 중단된 재시도는 같은 marker만 이어 쓴다', async () => {
    const github = githubMock();
    const fallback = metadata(names.collisionFallback);
    github.findRepository
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(fallback);
    github.createRepository.mockRejectedValueOnce(nameCollision());

    const repository = await findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    expect(repository).toEqual(fallback);
    expect(github.createRepository.mock.calls).toEqual([
      [names.preferred, OWNERSHIP_MARKER],
    ]);
  });

  it('fallback 이름도 다른 저장소가 소유하면 최종 실패한다', async () => {
    const github = githubMock();
    github.findRepository
      .mockResolvedValueOnce(metadata(names.preferred, null))
      .mockResolvedValueOnce(metadata(names.collisionFallback, null));

    const repository = findOrCreateGithubRepository(
      github,
      names,
      OWNERSHIP_MARKER,
    );

    await expect(repository).rejects.toEqual(nameCollision());
    expect(github.createRepository).not.toHaveBeenCalled();
  });
});

describe('parseGithubRepositoryUrl', () => {
  it('https://github.com/{owner}/{name} 만 허용한다', () => {
    expect(
      parseGithubRepositoryUrl(
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
    expect(parseGithubRepositoryUrl(url)).toBeNull();
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
