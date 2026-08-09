import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesController } from './controller/repositories.controller';
import { GithubAppClient } from './github-app.client';
import { GithubAppTokenProvider } from './github-app.token';
import { GithubOperationsConfig } from './github-operations.config';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoriesService } from './service/repositories.service';
import { REPOSITORIES_READ_PORT } from './repositories-read.port';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionScheduler } from './repository-provision.scheduler';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision.worker';

@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [RepositoriesController],
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
      inject: [RepositoriesRepository, GithubAppClient, AuditLogService],
      useFactory: (
        repository: RepositoriesRepository,
        github: GithubAppClient,
        auditLog: AuditLogService,
      ): RepositoriesService =>
        new RepositoriesService(repository, github, auditLog),
    },
    {
      provide: REPOSITORIES_READ_PORT,
      useExisting: RepositoriesService,
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
  exports: [RepositoriesService, REPOSITORIES_READ_PORT],
})
export class RepositoriesModule {}
