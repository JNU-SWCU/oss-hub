import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { AuditLogService } from '../platform/audit-log.service';
import { PlatformModule } from '../platform/platform.module';
import { ConsentsService } from '../users/consents.service';
import { UsersModule } from '../users/users.module';
import { CollectionAdminService } from './collection-admin.service';
import {
  CollectionCutoverRepository,
  CollectionUserActivityRepository,
  RepositoryProvisionJobRepository,
} from './repository-provision-job.repository';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { collectionProviders } from './collection-providers.service';
import {
  CollectionScheduler,
  CollectionTriggerService,
} from './collection-trigger.service';
import { GithubAppClient } from './github-app.client';
import { GithubAppTokenProvider } from './github-app-token.client';
import { GithubOperationsConfig } from './github-operations.config';
import { OwnRepositoryUrlValidationService } from './own-repository-url-validation.service';
import { RepositoriesReadService } from './repositories-read.service';
import { RepositoriesRepository } from './repositories.repository';
import {
  RepositoriesService,
  RepositoryOwnEnrollmentService,
} from './repositories.service';
import {
  RepositoryOutboxConsumer,
  RepositoryProvisionScheduler,
} from './repository-outbox-consumer.service';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision-worker.service';

@Module({
  imports: [ScheduleModule.forRoot(), PlatformModule, AuthModule, UsersModule],
  providers: [
    CollectionAdminService,
    CollectionScheduler,
    CollectionTriggerService,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionUserActivityRepository,
    ...collectionProviders,
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
    CollectionAdminService,
    CollectionTriggerService,
    RepositoriesService,
    RepositoriesReadService,
    OwnRepositoryUrlValidationService,
  ],
})
export class GithubModule {}
