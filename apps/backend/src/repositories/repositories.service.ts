import { Injectable } from '@nestjs/common';
import { RepositoryVisibility } from '@prisma/client';
import type { GithubAppClient } from './github-app.client';
import {
  RepositoriesRepository,
  RepositoryPublishStateError,
  type RepositoryPublishTarget,
} from './repositories.repository';

export class RepositoryNotFoundError extends Error {
  override readonly name = 'RepositoryNotFoundError';
}

export interface PublishRepositoryInput {
  readonly repositoryId: string;
}

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly repository: Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'markPublished'
    >,
    private readonly github: Pick<GithubAppClient, 'publishRepository'>,
  ) {}

  async publish(
    input: PublishRepositoryInput,
    now = new Date(),
  ): Promise<RepositoryPublishTarget> {
    const target = await this.repository.findPublishTarget(input.repositoryId);
    if (target === null) {
      throw new RepositoryNotFoundError();
    }
    if (target.visibility === RepositoryVisibility.PUBLIC) {
      return target;
    }
    const published = await this.github.publishRepository(target.name);
    if (
      published.githubRepositoryId !== target.githubRepositoryId ||
      published.name !== target.name ||
      published.visibility !== RepositoryVisibility.PUBLIC
    ) {
      throw new RepositoryPublishStateError();
    }
    await this.repository.markPublished(
      target.id,
      target.githubRepositoryId,
      now,
    );
    return {
      ...target,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: now,
    };
  }
}
