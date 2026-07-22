import { Module } from '@nestjs/common';
import { GithubAppClient } from './github-app.client';
import { GithubAppTokenProvider } from './github-app.token';
import { GithubOperationsConfig } from './github-operations.config';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoriesService } from './repositories.service';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import { RepositoryProvisionScheduler } from './repository-provision.scheduler';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision.worker';

@Module({
  providers: [
    GithubOperationsConfig,
    RepositoriesRepository,
    RepositoryOutboxConsumer,
    RepositoryProvisionJobRepository,
    RepositoryProvisionStateRepository,
    {
      provide: GithubAppTokenProvider,
      inject: [GithubOperationsConfig],
      useFactory: (config: GithubOperationsConfig): GithubAppTokenProvider =>
        new GithubAppTokenProvider(() => config.requireCredentials()),
    },
    {
      provide: GithubAppClient,
      inject: [GithubAppTokenProvider],
      useFactory: (tokenProvider: GithubAppTokenProvider): GithubAppClient =>
        new GithubAppClient(tokenProvider),
    },
    {
      provide: RepositoryProvisionWorker,
      inject: [
        RepositoryProvisionJobRepository,
        RepositoryProvisionStateRepository,
        GithubAppClient,
      ],
      useFactory: (
        jobs: RepositoryProvisionJobRepository,
        state: RepositoryProvisionStateRepository,
        github: GithubAppClient,
      ): RepositoryProvisionWorker =>
        new RepositoryProvisionWorker(jobs, state, github),
    },
    {
      provide: RepositoriesService,
      inject: [RepositoriesRepository, GithubAppClient],
      useFactory: (
        repository: RepositoriesRepository,
        github: GithubAppClient,
      ): RepositoriesService => new RepositoriesService(repository, github),
    },
    {
      provide: RepositoryProvisionScheduler,
      inject: [RepositoryOutboxConsumer, RepositoryProvisionWorker],
      useFactory: (
        outbox: RepositoryOutboxConsumer,
        worker: RepositoryProvisionWorker,
      ): RepositoryProvisionScheduler =>
        new RepositoryProvisionScheduler(outbox, worker),
    },
  ],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
