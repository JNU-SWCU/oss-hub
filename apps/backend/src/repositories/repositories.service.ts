import { Injectable } from '@nestjs/common';
import {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
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
      'findPublishTarget' | 'markPublished' | 'listOwnedProvisionJobs'
    >,
    private readonly github: Pick<GithubAppClient, 'publishRepository'>,
  ) {}
  async getMyRepositories(githubId: bigint): Promise<readonly MyRepository[]> {
    const jobs = await this.repository.listOwnedProvisionJobs(githubId);
    return jobs.map((job) => {
      if (
        job.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        (job.repository === null ||
          job.repository.applicationId !== job.application.id)
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
