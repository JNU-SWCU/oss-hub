import { Injectable } from '@nestjs/common';
import {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import {
  REPOSITORY_PUBLISH_AUDIT_ACTIONS,
  createRepositoryPublishAuditMetadata,
} from '../audit-log/audit-log-metadata';
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
export interface MyRepository {
  readonly repositoryId: string | null;
  readonly applicationId: string;
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
  ) {}
  async getMyRepositories(githubId: bigint): Promise<readonly MyRepository[]> {
    const jobs = await this.repository.listOwnedProvisionJobs(githubId);
    return jobs.map((job) => {
      if (
        job.repository !== null &&
        job.repository.applicationId !== job.application.id
      ) {
        throw new RepositoryProvisionStateError();
      }
      if (
        job.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        job.repository === null
      ) {
        throw new RepositoryProvisionStateError();
      }
      if (
        job.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        job.repository !== null &&
        !isValidSucceededRepositoryIdentity(
          job.repository.name,
          job.repository.url,
          job.application.repositoryConnectionMode,
        )
      ) {
        throw new RepositoryProvisionStateError();
      }
      const repository =
        job.status === RepositoryProvisionJobStatus.SUCCEEDED
          ? job.repository
          : null;

      return {
        repositoryId: repository?.id ?? null,
        applicationId: job.application.id,
        applicationMode: job.application.teamId === null ? 'PERSONAL' : 'TEAM',
        programName: job.application.program.name,
        displayName:
          job.application.team?.name ?? job.application.applicant.nickname,
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
      await this.auditLog.record(
        {
          actorGithubId,
          action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
          targetType: 'REPOSITORY',
          targetId: target.id,
          metadata: createRepositoryPublishAuditMetadata({
            repositoryId: target.id,
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
        ...target,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      };
    });
  }
}

function isValidSucceededRepositoryIdentity(
  name: string,
  url: string,
  connectionMode: RepositoryConnectionMode,
): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
    return false;
  }
  // OWN은 학생이 준 외부 URL을 그대로 쓴다. NEW만 조직 불변식을 강제한다.
  if (connectionMode === RepositoryConnectionMode.OWN) {
    return url.length > 0;
  }
  return url === `https://github.com/JNU-SWCU/${name}`;
}
