import { RepositoryVisibility } from '@prisma/client';
import type { GithubAppClient } from './github-app.client';
import type { RepositoriesRepository } from './repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
} from './repositories.service';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const target = {
  id: 'synthetic-repository-id',
  githubRepositoryId: 987654321n,
  name: 'synthetic-repository',
  url: 'https://github.com/synthetic-org/synthetic-repository',
  visibility: RepositoryVisibility.PRIVATE,
  publishedAt: null,
};

function dependencies() {
  const repository = {
    findPublishTarget: jest.fn().mockResolvedValue(target),
    markPublished: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<
    Pick<RepositoriesRepository, 'findPublishTarget' | 'markPublished'>
  >;
  const github = {
    publishRepository: jest.fn().mockResolvedValue({
      githubRepositoryId: target.githubRepositoryId,
      name: target.name,
      url: target.url,
      visibility: RepositoryVisibility.PUBLIC,
    }),
  } as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
  return { repository, github };
}

describe('RepositoriesService.publish', () => {
  it('이미 public인 repository는 GitHub를 다시 호출하지 않는다', async () => {
    // Given: DB가 이미 공개 완료 상태다.
    const { repository, github } = dependencies();
    repository.findPublishTarget.mockResolvedValue({
      ...target,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
    const service = new RepositoriesService(repository, github);

    // When: 같은 공개 요청을 반복한다.
    const result = await service.publish({ repositoryId: target.id }, NOW);

    // Then: 외부 변경 없이 기존 상태로 수렴한다.
    expect(result.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
    expect(repository.markPublished.mock.calls).toHaveLength(0);
  });

  it('GitHub 공개 결과의 identity를 확인한 뒤 DB를 갱신한다', async () => {
    // Given: private repository가 있다.
    const { repository, github } = dependencies();
    const service = new RepositoriesService(repository, github);

    // When: 공개 전환을 요청한다.
    const result = await service.publish({ repositoryId: target.id }, NOW);

    // Then: 같은 external repository만 공개 완료로 기록한다.
    expect(github.publishRepository.mock.calls).toEqual([[target.name]]);
    expect(repository.markPublished.mock.calls).toEqual([
      [target.id, target.githubRepositoryId, NOW],
    ]);
    expect(result).toMatchObject({
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
  });

  it('없는 repository는 GitHub 호출 전에 중단한다', async () => {
    // Given: DB에 대상 repository가 없다.
    const { repository, github } = dependencies();
    repository.findPublishTarget.mockResolvedValue(null);
    const service = new RepositoriesService(repository, github);

    // When: 공개 전환을 요청한다.
    const publish = service.publish({ repositoryId: 'missing' }, NOW);

    // Then: 명시 오류로 중단하고 외부 호출을 막는다.
    await expect(publish).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
  });
});
