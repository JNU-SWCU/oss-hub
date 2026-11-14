import { CollectionScheduleService } from './collection-schedule.service';
import { Module } from '@nestjs/common';
import { APPLICATION_SCHEDULE_MODULE } from './maintenance.config';
import { PlatformModule } from '../platform/platform.module';
import { UsersModule } from '../users/users.module';
import { CollectionAdminService } from './collection-admin.service';
import {
  CollectionUserActivityRepository,
  RepositoryProvisionJobRepository,
} from './repository-provision-job.repository';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { COLLECTION_PROVIDERS } from './collection-public-token.service';
import { CollectionTriggerService } from './collection-trigger.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
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
import { RepositoryProvisionEventService } from './repository-provision-event.service';
import { RepositoryProvisionStateService } from './repository-provision-state.service';
import { RepositoryPublishService } from './repository-publish.service';
import { RepositoryUrlService } from './repository-url.service';
import { RepositoryProvisionGithubService } from './repository-provision-github.service';

@Module({
  imports: [APPLICATION_SCHEDULE_MODULE, PlatformModule, UsersModule],
  providers: [
    CollectionScheduleService,
    CollectionAdminService,
    CollectionTriggerService,
    CollectionIncrementalRepository,
    CollectionUserActivityRepository,
    ...COLLECTION_PROVIDERS,
    RepositoryOwnEnrollmentService,
    GithubOperationsConfig,
    RepositoriesRepository,
    RepositoryOutboxConsumerService,
    RepositoryProvisionJobRepository,
    RepositoryProvisionStateRepository,
    RepositoryProvisionEventService,
    RepositoryProvisionStateService,
    RepositoryPublishService,
    RepositoryUrlService,
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
    RepositoryProvisionWorkerService,
    RepositoriesService,
    OwnRepositoryUrlValidationService,
    RepositoriesReadService,
  ],
  exports: [
    CollectionAdminService,
    CollectionScheduleService,
    CollectionTriggerService,
    CollectionUserActivityService,
    RepositoriesService,
    RepositoriesReadService,
    OwnRepositoryUrlValidationService,
    RepositoryProvisionEventService,
    RepositoryPublishService,
    RepositoryUrlService,
  ],
})
export class GithubModule {}
