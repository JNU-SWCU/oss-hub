import { Injectable } from '@nestjs/common';
import { RepositoryVisibility } from '@prisma/client';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import {
  REPOSITORY_PUBLISH_AUDIT_ACTIONS,
  createRepositoryPublishAuditMetadata,
  deriveRepositoryFullName,
} from '../../audit-log/domain/audit-log-metadata';
import type { GithubAppClient } from '../github-app.client';
import {
  RepositoriesRepository,
  RepositoryPublishStateError,
  type RepositoryPublishTarget,
} from '../repository/repositories.repository';

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
      'findPublishTarget' | 'withTransaction'
    >,
    private readonly github: Pick<GithubAppClient, 'publishRepository'>,
    private readonly auditLog: Pick<AuditLogService, 'record'>,
  ) {}

  async publish(
    input: PublishRepositoryInput,
    actorGithubId: bigint,
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

    return this.repository.withTransaction(async (store) => {
      const won = await store.publishRepositoryIfPrivate(
        target.id,
        target.githubRepositoryId,
        now,
      );
      if (!won) {
        const reloaded = await store.findPublishTarget(target.id);
        if (reloaded === null) {
          throw new RepositoryNotFoundError();
        }
        return reloaded;
      }

      const committed = await store.findPublishTarget(target.id);
      if (committed === null) {
        throw new RepositoryNotFoundError();
      }
      await this.auditLog.record(
        {
          actorGithubId,
          action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
          targetType: 'REPOSITORY',
          targetId: target.id,
          metadata: createRepositoryPublishAuditMetadata({
            repositoryId: target.id,
            repositoryFullName: deriveRepositoryFullName(
              committed.name,
              committed.url,
            ),
            before: { visibility: RepositoryVisibility.PRIVATE },
            after: {
              visibility: RepositoryVisibility.PUBLIC,
              publishedAt: now.toISOString(),
            },
          }),
        },
        store.auditLogWriter,
      );
      return {
        ...committed,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      };
    });
  }
}
