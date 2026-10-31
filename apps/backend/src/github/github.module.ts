import { CollectionScheduleService } from './collection-schedule.service';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { CollectionTriggerService } from './collection-trigger.service';
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
import { RepositoryOutboxConsumerService } from './repository-outbox-consumer.service';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionWorkerService } from './repository-provision-worker.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { RepositoryProvisionEventService } from './repository-provision-event.service';
import { RepositoryProvisionStateService } from './repository-provision-state.service';
import { RepositoryPublishService } from './repository-publish.service';
import { RepositoryUrlService } from './repository-url.service';
import { RepositoryProvisionRulesService } from './repository-provision-rules.service';
import { RepositoryProvisionGithubService } from './repository-provision-github.service';

@Module({
  imports: [ScheduleModule.forRoot(), PlatformModule, UsersModule],
  providers: [
    CollectionScheduleService,
    CollectionAdminService,
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
    RepositoryProvisionEventService,
    RepositoryProvisionStateService,
    RepositoryPublishService,
    RepositoryUrlService,
    RepositoryProvisionRulesService,
    RepositoryProvisionGithubService,
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
        RepositoryProvisionStateService,
        GithubAppClient,
        RepositoryOwnEnrollmentService,
        AuditLogMetadataService,
        RepositoryProvisionRulesService,
        RepositoryProvisionGithubService,
      ],
      useFactory: (
        jobs: RepositoryProvisionJobRepository,
        state: RepositoryProvisionStateService,
        github: GithubAppClient,
        enrollment: RepositoryOwnEnrollmentService,
        auditLogMetadata: AuditLogMetadataService,
        provisionRules: RepositoryProvisionRulesService,
        provisionGithub: RepositoryProvisionGithubService,
      ): RepositoryProvisionWorkerService =>
        new RepositoryProvisionWorkerService(
          jobs,
          state,
          github,
          enrollment,
          auditLogMetadata,
          provisionRules,
          provisionGithub,
        ),
    },
    {
      provide: RepositoriesService,
      inject: [
        RepositoriesRepository,
        GithubAppClient,
        AuditLogService,
        AuditLogMetadataService,
        RepositoryUrlService,
      ],
      useFactory: (
        repository: RepositoriesRepository,
        github: GithubAppClient,
        auditLog: AuditLogService,
        auditLogMetadata: AuditLogMetadataService,
        repositoryUrl: RepositoryUrlService,
      ): RepositoriesService =>
        new RepositoriesService(
          repository,
          github,
          auditLog,
          auditLogMetadata,
          repositoryUrl,
        ),
    },
    {
      provide: OwnRepositoryUrlValidationService,
      inject: [GithubAppClient, RepositoryProvisionGithubService],
      useFactory: (
        github: GithubAppClient,
        repositoryProvisionGithub: RepositoryProvisionGithubService,
      ): OwnRepositoryUrlValidationService =>
        new OwnRepositoryUrlValidationService(
          github,
          repositoryProvisionGithub,
        ),
    },
    RepositoriesReadService,
  ],
  exports: [
    CollectionAdminService,
    CollectionScheduleService,
    CollectionTriggerService,
    RepositoriesService,
    RepositoriesReadService,
    OwnRepositoryUrlValidationService,
    RepositoryProvisionEventService,
    RepositoryPublishService,
    RepositoryUrlService,
  ],
})
export class GithubModule {}
