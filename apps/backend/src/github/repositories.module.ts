import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { ConsentsService } from '../consents/service/consents.service';
import { RepositoriesController } from './controller/repositories.controller';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { GithubAppClient } from './gateway/github-app.client';
import { GithubAppTokenProvider } from './gateway/github-app.token';
import { GithubOperationsConfig } from './github-operations.config';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoriesService } from './service/repositories.service';
import { RepositoriesReadService } from './service/repositories-read.service';
import { RepositoryOutboxConsumer } from './service/repository-outbox.consumer';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionScheduler } from './job/repository-provision.scheduler';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryProvisionWorker } from './service/repository-provision.worker';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';
import { OwnRepositoryUrlValidationService } from './service/own-repository-url-validation.service';

@Module({
  imports: [AuthModule, AuditLogModule, ConsentsModule],
  controllers: [RepositoriesController],
  providers: [
    CollectionIncrementalRepository,
    {
      provide: RepositoryOwnEnrollmentService,
      inject: [ConsentsService, CollectionIncrementalRepository],
      useFactory: (
        consents: ConsentsService,
        enrollment: CollectionIncrementalRepository,
      ): RepositoryOwnEnrollmentService =>
        new RepositoryOwnEnrollmentService(consents, enrollment),
    },
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
        RepositoryOwnEnrollmentService,
      ],
      useFactory: (
        jobs: RepositoryProvisionJobRepository,
        state: RepositoryProvisionStateRepository,
        github: GithubAppClient,
        enrollment: RepositoryOwnEnrollmentService,
      ): RepositoryProvisionWorker =>
        new RepositoryProvisionWorker(jobs, state, github, enrollment),
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
      provide: OwnRepositoryUrlValidationService,
      inject: [GithubAppClient],
      useFactory: (
        github: GithubAppClient,
      ): OwnRepositoryUrlValidationService =>
        new OwnRepositoryUrlValidationService(github),
    },
    RepositoriesReadService,
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
  exports: [
    RepositoriesService,
    RepositoriesReadService,
    OwnRepositoryUrlValidationService,
  ],
})
export class RepositoriesModule {}
