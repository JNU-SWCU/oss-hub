import { Injectable } from '@nestjs/common';
import {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import {
  REPOSITORY_PUBLISH_AUDIT_ACTIONS,
  createRepositoryPublishAuditMetadata,
  deriveRepositoryFullName,
} from '../../audit-log/audit-log-metadata';
import type { GithubAppClient } from '../github-app.client';
import type { GithubOperationsConfig } from '../github-operations.config';
import { parseGithubRepositoryUrl } from '../../common/github-repository-url';
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
export interface MyRepository {
  readonly repositoryId: string | null;
  readonly applicationId: string;
  readonly connectionMode: RepositoryConnectionMode;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly visibility: RepositoryVisibility | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
}

export class RepositoryProvisionStateError extends Error {
  override readonly name = 'RepositoryProvisionStateError';
}

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly repository: Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'listOwnedProvisionJobs' | 'withTransaction'
    >,
    private readonly github: Pick<GithubAppClient, 'publishRepository'>,
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    private readonly organizationConfig: Pick<
      GithubOperationsConfig,
      'requireOrganization'
    >,
  ) {}
  async getMyRepositories(githubId: bigint): Promise<readonly MyRepository[]> {
    const jobs = await this.repository.listOwnedProvisionJobs(githubId);
    return jobs.map((job) => {
      const repository = job.application.repository;
      if (repository !== null) {
        if (
          !isValidRepositoryIdentity(
            repository.name,
            repository.url,
            repository.source,
            this.organizationConfig.requireOrganization(),
          )
        ) {
          throw new RepositoryProvisionStateError();
        }
      } else if (job.status === RepositoryProvisionJobStatus.SUCCEEDED) {
        throw new RepositoryProvisionStateError();
      }

      const applicationMode: 'PERSONAL' | 'TEAM' =
        (job.application.team?._count.members ?? 0) > 1 ? 'TEAM' : 'PERSONAL';

      const connectionMode =
        repository === null ||
        job.application.repositoryConnectionMode ===
          RepositoryConnectionMode.OWN
          ? job.application.repositoryConnectionMode
          : connectionModeFromSource(repository.source);

      return {
        repositoryId: repository?.id ?? null,
        applicationId: job.application.id,
        connectionMode,
        applicationMode,
        programName: job.application.program.name,
        displayName:
          applicationMode === 'TEAM'
            ? (job.application.team?.name ?? job.application.applicant.nickname)
            : job.application.applicant.nickname,
        repositoryName: repository?.name ?? null,
        githubUrl: repository?.url ?? null,
        provisionStatus: job.status,

        invitationStatus: repository?.invitations[0]?.status ?? null,
        visibility: repository?.visibility ?? null,
        lastErrorCode: job.lastErrorCode,
        updatedAt: job.updatedAt,
      };
    });
  }

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

function connectionModeFromSource(
  source: RepositorySource,
): RepositoryConnectionMode {
  return source === RepositorySource.EXTERNAL_PUBLIC
    ? RepositoryConnectionMode.OWN
    : RepositoryConnectionMode.NEW;
}

function isValidRepositoryIdentity(
  name: string,
  url: string,
  source: RepositorySource,
  organization: string,
): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
    return false;
  }

  if (source === RepositorySource.EXTERNAL_PUBLIC) {
    return parseGithubRepositoryUrl(url) !== null;
  }
  return url === `https://github.com/${organization}/${name}`;
}
