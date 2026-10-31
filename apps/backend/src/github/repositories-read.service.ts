import { Inject, Injectable } from '@nestjs/common';
import {
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { MyRepositoryResult } from './repositories-read.types';
import { GithubOperationsConfig } from './github-operations.config';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoryProvisionStateError } from './repository-provision-state.error';
import { RepositoryUrlService } from './repository-url.service';

@Injectable()
export class RepositoriesReadService {
  constructor(
    @Inject(RepositoriesRepository)
    private readonly repository: Pick<
      RepositoriesRepository,
      'listOwnedProvisionJobs'
    >,
    @Inject(GithubOperationsConfig)
    private readonly organizationConfig: Pick<
      GithubOperationsConfig,
      'requireOrganization'
    >,
    private readonly repositoryUrlService: RepositoryUrlService,
  ) {}

  async getMyRepositories(
    githubId: bigint,
  ): Promise<readonly MyRepositoryResult[]> {
    const jobs = await this.repository.listOwnedProvisionJobs(githubId);
    return jobs.map((job) => {
      const row = job.application.repository;
      const repository = row && {
        ...row,
        name: this.repositoryUrlService.repositoryNameFromNameWithOwner(
          row.nameWithOwner,
        ),
        url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
          row.nameWithOwner,
        ),
      };
      if (repository !== null) {
        if (
          !this.isValidRepositoryIdentity(
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

  private isValidRepositoryIdentity(
    name: string,
    url: string,
    source: RepositorySource,
    organization: string,
  ): boolean {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
      return false;
    }

    if (source === RepositorySource.EXTERNAL_PUBLIC) {
      return this.repositoryUrlService.parseGithubRepositoryUrl(url) !== null;
    }
    return url === `https://github.com/${organization}/${name}`;
  }
}

function connectionModeFromSource(
  source: RepositorySource,
): RepositoryConnectionMode {
  return source === RepositorySource.EXTERNAL_PUBLIC
    ? RepositoryConnectionMode.OWN
    : RepositoryConnectionMode.NEW;
}
