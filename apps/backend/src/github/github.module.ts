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
import { CollectionProvidersService } from './collection-providers.service';
import {
  CollectionScheduler,
  CollectionTriggerService,
} from './collection-trigger.service';
import { GithubAppClient } from './github-app.client';
import { GithubAppTokenClient } from './github-app-token.client';
import { GithubOperationsConfig } from './github-operations.config';
import { OwnRepositoryUrlValidationService } from './own-repository-url-validation.service';
import { RepositoriesReadService } from './repositories-read.service';
import { RepositoriesRepository } from './repositories.repository';
import {
  RepositoriesService,
  RepositoryOwnEnrollmentService,
} from './repositories.service';
import {
  RepositoryOutboxConsumerService,
  RepositoryProvisionScheduler,
} from './repository-outbox-consumer.service';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionWorkerService } from './repository-provision-worker.service';

@Module({
  imports: [ScheduleModule.forRoot(), PlatformModule, AuthModule, UsersModule],
  providers: [
    CollectionAdminService,
    CollectionScheduler,
    CollectionTriggerService,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionUserActivityRepository,
    ...CollectionProvidersService.providers,
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
    RepositoryOutboxConsumerService,
    RepositoryProvisionJobRepository,
    RepositoryProvisionStateRepository,
    {
      provide: GithubAppTokenClient,
      inject: [GithubOperationsConfig],
      useFactory: (config: GithubOperationsConfig): GithubAppTokenClient =>
        new GithubAppTokenClient(() => config.requireCredentials()),
    },
    {
      provide: GithubAppClient,
      inject: [GithubAppTokenClient],
      useFactory: (tokenProvider: GithubAppTokenClient): GithubAppClient =>
        new GithubAppClient(tokenProvider),
    },
    {
      provide: RepositoryProvisionWorkerService,
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
      ): RepositoryProvisionWorkerService =>
        new RepositoryProvisionWorkerService(jobs, state, github, enrollment),
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
      inject: [
        RepositoryOutboxConsumerService,
        RepositoryProvisionWorkerService,
      ],
      useFactory: (
        outbox: RepositoryOutboxConsumerService,
        worker: RepositoryProvisionWorkerService,
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
