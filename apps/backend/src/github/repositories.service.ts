import { Injectable } from '@nestjs/common';
import { ConsentsService } from '../users/consents.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { RepositoryVisibility } from '@prisma/client';
import { GithubAppClient } from './github-app.client';
import {
  RepositoriesRepository,
  type RepositoryPublishTarget,
  type RepositoryPublishTargetRow,
} from './repositories.repository';
import { RepositoryPublishStateError } from './repository-publish-state.error';
import { RepositoryNotFoundError } from './repositories.error';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryUrlService } from './repository-url.service';

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
    private readonly consents: ConsentsService,
    private readonly enrollment: CollectionIncrementalRepository,
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
  readonly githubRepositoryId: bigint;
}

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly repository: RepositoriesRepository,
    private readonly github: GithubAppClient,
    private readonly historyMetadataService: HistoryMetadataService,
    private readonly repositoryUrlService: RepositoryUrlService,
  ) {}

  private toPublishTarget(
    row: RepositoryPublishTargetRow,
  ): RepositoryPublishTarget {
    return {
      githubRepositoryId: row.githubRepositoryId,
      name: this.repositoryUrlService.repositoryNameFromNameWithOwner(
        row.nameWithOwner,
      ),
      url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
        row.nameWithOwner,
      ),
      visibility: row.visibility,
      publishedAt: row.publishedAt,
    };
  }

  async publish(
    input: PublishRepositoryInput,
    actorGithubId: bigint,
    now = new Date(),
  ): Promise<RepositoryPublishTarget> {
    const targetRow = await this.repository.findPublishTarget(
      input.githubRepositoryId,
    );
    if (targetRow === null) {
      throw new RepositoryNotFoundError();
    }
    const target = this.toPublishTarget(targetRow);
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
        target.githubRepositoryId,
        now,
      );
      if (!won) {
        const reloaded = await store.findPublishTarget(
          target.githubRepositoryId,
        );
        if (reloaded === null) {
          throw new RepositoryNotFoundError();
        }
        return this.toPublishTarget(reloaded);
      }

      const committedRow = await store.findPublishTarget(
        target.githubRepositoryId,
      );
      if (committedRow?.team == null) {
        throw new RepositoryNotFoundError();
      }
      const committed = this.toPublishTarget(committedRow);
      const actor = await store.historyWriter.user.findUniqueOrThrow({
        where: { githubId: actorGithubId },
        select: { id: true },
      });
      await store.historyWriter.teamHistory.create({
        data: {
          teamId: committedRow.team.id,
          programId: committedRow.team.programId,
          actorId: actor.id,
          event: 'REPOSITORY_PUBLISHED',
          source: 'APPLICATION',
          data: {
            schemaVersion: 1,
            targetType: 'REPOSITORY',
            targetId: target.githubRepositoryId.toString(),
            metadata:
              this.historyMetadataService.createRepositoryPublishAuditMetadata({
                repositoryId: target.githubRepositoryId.toString(),
                repositoryFullName:
                  this.historyMetadataService.deriveRepositoryFullName(
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
        },
      });
      return {
        ...committed,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      };
    });
  }
}
