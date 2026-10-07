import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppConfig } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { ContributionInvariants } from './contribution-invariants';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionPublicTokenProvider } from './collection-public.token';
import { CollectionReadService } from './service/collection-read.service';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import { COLLECTION_TRIGGER_PORT } from './collection-trigger.port';
import { CollectionUserActivityService } from './service/collection-user-activity.service';
import { ProviderRequestQueue } from './collection-provider-queue';
import {
  CollectionSyncRuntime,
  CollectionSyncRuntimeFactory,
  CollectionSyncService,
} from './service/collection-sync.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule, AuthModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminGuard,
    ContributionInvariants,
    CollectionSchedulerService,

    {
      provide: COLLECTION_TRIGGER_PORT,
      useExisting: CollectionSchedulerService,
    },
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionReadService,
    {
      provide: CollectionPublicTokenProvider,
      inject: [RUNTIME_CONFIG],
      useFactory: (
        runtimeConfig: RuntimeConfig,
      ): CollectionPublicTokenProvider =>
        new CollectionPublicTokenProvider(runtimeConfig),
    },
    {
      provide: CollectionDiscoveryClient,
      inject: [CollectionPublicTokenProvider],
      useFactory: (
        tokens: CollectionPublicTokenProvider,
      ): CollectionDiscoveryClient => new CollectionDiscoveryClient({}, tokens),
    },
    {
      provide: CollectionUserActivityService,
      inject: [PrismaService, CollectionDiscoveryClient],
      useFactory: (
        prisma: PrismaService,
        discoveryClient: CollectionDiscoveryClient,
      ): CollectionUserActivityService =>
        new CollectionUserActivityService(prisma, discoveryClient),
    },
    {
      provide: CollectionSyncService,
      inject: [
        CollectionIncrementalRepository,
        RUNTIME_CONFIG,
        CollectionPublicTokenProvider,
      ],
      useFactory: (
        incrementalRepository: CollectionIncrementalRepository,
        runtimeConfig: RuntimeConfig,
        publicTokens: CollectionPublicTokenProvider,
      ): CollectionSyncService => {
        let orgTokens: CollectionAppTokenProvider | undefined;
        let runtime: CollectionSyncRuntime | undefined;
        const runtimeFactory: CollectionSyncRuntimeFactory = () => {
          if (runtime) return runtime;

          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
          orgTokens = new CollectionAppTokenProvider(config);
          const queue = new ProviderRequestQueue();
          runtime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens: orgTokens,
            client: new CollectionAppClient(
              config,
              orgTokens,
              queue.wrapFetcher(globalThis.fetch),
            ),
            queue,
          };
          return runtime;
        };
        const resolveGithubOrganizationId = async (): Promise<bigint> => {
          if (!orgTokens) {
            const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
            orgTokens = new CollectionAppTokenProvider(config);
          }
          const identity = await orgTokens.getInstallationIdentity();
          return BigInt(identity.organizationId);
        };

        let externalRuntime: CollectionSyncRuntime | undefined;
        const externalRuntimeFactory: CollectionSyncRuntimeFactory = () => {
          if (externalRuntime) return externalRuntime;
          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
          const queue = new ProviderRequestQueue();
          externalRuntime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens: publicTokens,
            client: new CollectionAppClient(
              config,
              publicTokens,
              queue.wrapFetcher(globalThis.fetch),
            ),
            queue,
          };
          return externalRuntime;
        };
        return new CollectionSyncService(
          incrementalRepository,
          runtimeFactory,
          resolveGithubOrganizationId,
          undefined,
          undefined,
          externalRuntimeFactory,
        );
      },
    },
  ],
  exports: [COLLECTION_TRIGGER_PORT],
})
export class CollectionModule {}
