import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppConfig } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionConfig } from './collection.config';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import {
  CollectionReconciliationRuntimeFactory,
  CollectionReconciliationRuntime,
  CollectionReconciliationService,
} from './collection-reconciliation.service';
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
    CollectionCanonicalRepository,
    {
      provide: CollectionReconciliationService,
      inject: [CollectionCanonicalRepository],
      useFactory: (
        canonicalRepository: CollectionCanonicalRepository,
      ): CollectionReconciliationService => {
        let runtime: CollectionReconciliationRuntime | undefined;
        const runtimeFactory: CollectionReconciliationRuntimeFactory = () => {
          if (runtime) return runtime;
          const config = CollectionAppConfig.fromEnv();
          const tokens = new CollectionAppTokenProvider(config);
          runtime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens,
            client: new CollectionAppClient(config, tokens),
          };
          return runtime;
        };
        return new CollectionReconciliationService(
          canonicalRepository,
          runtimeFactory,
        );
      },
    },
    {
      provide: GithubApiClient,
      inject: [CollectionConfig],
      useFactory: (config: CollectionConfig): GithubApiClient =>
        new GithubApiClient(() => config.requireCredentials()),
    },
  ],
  exports: [
    CollectionConfig,
    CollectionService,
    CollectionReconciliationService,
  ],
})
export class CollectionModule {}
