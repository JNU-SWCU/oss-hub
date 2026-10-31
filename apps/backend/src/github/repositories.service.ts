import { Injectable } from '@nestjs/common';
import type { ConsentsService } from '../users/consents.service';
import type { CollectionIncrementalRepository } from './collection-incremental.repository';
import { RepositoryVisibility } from '@prisma/client';
import type { AuditLogService } from '../platform/audit-log.service';
import type { GithubAppClient } from './github-app.client';
import {
  RepositoriesRepository,
  type RepositoryPublishTarget,
} from './repositories.repository';
import { RepositoryPublishStateError } from './repository-publish-state.error';
import { RepositoryNotFoundError } from './repositories.error';
import { REPOSITORY_PUBLISH_AUDIT_ACTIONS } from '../platform/audit-log-metadata.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

export interface OwnRepositoryEnrollmentInput {
  readonly applicantGithubId: bigint;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly observedAt: Date;
}

@Injectable()
export class RepositoryOwnEnrollmentService {
  constructor(
    private readonly consents: Pick<ConsentsService, 'requireCurrent'>,
    private readonly enrollment: Pick<
      CollectionIncrementalRepository,
      'enrollExternalRepository'
    >,
  ) {}

  async enrollExternalRepository(
    input: OwnRepositoryEnrollmentInput,
  ): Promise<void> {
    await this.consents.requireCurrent(input.applicantGithubId);
    await this.enrollment.enrollExternalRepository({
      githubRepositoryId: input.githubRepositoryId,
      nameWithOwner: input.nameWithOwner,
      defaultBranch: input.defaultBranch,
      archived: input.archived,
      observedAt: input.observedAt,
    });
  }
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
    private readonly auditLogMetadataService: AuditLogMetadataService,
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
          metadata:
            this.auditLogMetadataService.createRepositoryPublishAuditMetadata({
              repositoryId: target.id,
              repositoryFullName:
                this.auditLogMetadataService.deriveRepositoryFullName(
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
