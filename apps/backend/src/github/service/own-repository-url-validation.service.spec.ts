import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../github-app.error';
import type { GithubAppClient } from '../github-app.client';
import { OwnRepositoryUrlValidationService } from './own-repository-url-validation.service';

function githubMock(): jest.Mocked<
  Pick<GithubAppClient, 'findRepository' | 'findPublicRepository'>
> & { readonly organization: string } {
  return {
    organization: 'synthetic-org',
    findRepository: jest.fn().mockResolvedValue(null),
    findPublicRepository: jest.fn().mockResolvedValue(null),
  };
}

describe('OwnRepositoryUrlValidationService', () => {
  it('외부 공개 저장소 URL은 VALID로 판정한다', async () => {
    const github = githubMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: 1n,
      name: 'econovation-repo',
      nameWithOwner: 'eco-external-org/econovation-repo',
      url: 'https://github.com/eco-external-org/econovation-repo',
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/eco-external-org/econovation-repo'),
    ).resolves.toEqual({ kind: 'VALID' });
  });

  it('조직 소유 저장소는 App 조회 경로로 VALID 판정한다', async () => {
    const github = githubMock();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: 2n,
      name: 'org-repo',
      nameWithOwner: 'synthetic-org/org-repo',
      url: 'https://github.com/synthetic-org/org-repo',
      visibility: 'PRIVATE',
      description: null,
    });
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/synthetic-org/org-repo'),
    ).resolves.toEqual({ kind: 'VALID' });
  });

  it('존재하지 않는 외부 저장소는 NOT_FOUND_OR_PRIVATE다', async () => {
    const github = githubMock();
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/synthetic-student/missing-repo'),
    ).resolves.toEqual({ kind: 'NOT_FOUND_OR_PRIVATE' });
  });

  it('비공개 외부 저장소는 NOT_FOUND_OR_PRIVATE다', async () => {
    const github = githubMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: 3n,
      name: 'private-repo',
      nameWithOwner: 'synthetic-student/private-repo',
      url: 'https://github.com/synthetic-student/private-repo',
      visibility: 'PRIVATE',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/synthetic-student/private-repo'),
    ).resolves.toEqual({ kind: 'NOT_FOUND_OR_PRIVATE' });
  });

  it('접근할 수 없는 조직 저장소도 NOT_FOUND_OR_PRIVATE다', async () => {
    const github = githubMock();
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/synthetic-org/inaccessible-repo'),
    ).resolves.toEqual({ kind: 'NOT_FOUND_OR_PRIVATE' });
  });

  it.each([
    'not-a-url',
    'https://example.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo?tab=readme',
    'https://github.com/owner',
  ])('형식이 잘못된 URL(%s)은 INVALID_FORMAT이다', async (malformed) => {
    const github = githubMock();
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(service.validate(malformed)).resolves.toEqual({
      kind: 'INVALID_FORMAT',
    });
  });

  it('일시적 GitHub 장애는 제출을 막지 않고 VALID로 fail-open한다', async () => {
    const github = githubMock();
    github.findPublicRepository.mockRejectedValue(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
      ),
    );
    const service = new OwnRepositoryUrlValidationService(github);

    await expect(
      service.validate('https://github.com/synthetic-student/synthetic-repo'),
    ).resolves.toEqual({ kind: 'VALID' });
  });
});
