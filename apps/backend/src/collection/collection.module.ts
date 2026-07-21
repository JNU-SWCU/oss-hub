import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionConfig } from './collection.config';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionService } from './collection.service';
import { GithubApiClient } from './github-api.client';
import { GithubWebhookConfig } from './github-webhook.config';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookRepository } from './github-webhook.repository';
import { GithubWebhookService } from './github-webhook.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  controllers: [
    CollectionController,
    CollectionAdminController,
    GithubWebhookController,
  ],
  providers: [
    CollectionConfig,
    GithubWebhookConfig,
    GithubWebhookRepository,
    GithubWebhookService,
    CollectionAdminGuard,
    CollectionRepository,
    CollectionRunStarter,
    CollectionSchedulerService,
    CollectionService,
    {
      provide: GithubApiClient,
      inject: [CollectionConfig],
      useFactory: (config: CollectionConfig): GithubApiClient =>
        new GithubApiClient(() => config.requireCredentials()),
    },
  ],
  exports: [CollectionConfig, CollectionService],
})
export class CollectionModule {}
