import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { ConsentsService } from '../consents/consents.service';
import { RepositoriesController } from './controller/repositories.controller';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
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
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';

@Module({
  imports: [AuthModule, AuditLogModule, ConsentsModule],
  controllers: [RepositoriesController],
  providers: [
    // OWN 저장소를 수집 큐에 편입하기 위해 필요하다(ADR-010 §6).
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
      inject: [
        RepositoriesRepository,
        GithubAppClient,
        AuditLogService,
        GithubOperationsConfig,
      ],
      useFactory: (
        repository: RepositoriesRepository,
        github: GithubAppClient,
        auditLog: AuditLogService,
        config: GithubOperationsConfig,
      ): RepositoriesService =>
        new RepositoriesService(repository, github, auditLog, config),
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
