import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppConfig } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import { CollectionCutoverService } from './collection-cutover.service';
import { CollectionGenerationImportService } from './collection-generation-import.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { COLLECTION_READ_PORT } from './collection-read.port';
import { CollectionReadService } from './collection-read.service';
import {
  CollectionReconciliationRuntimeFactory,
  CollectionReconciliationRuntime,
  CollectionReconciliationService,
} from './collection-reconciliation.service';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { ProviderRequestQueue } from './collection-provider-queue';
import {
  CollectionSyncRuntime,
  CollectionSyncRuntimeFactory,
  CollectionSyncService,
} from './collection-sync.service';

/**
 * todo 14 원자 전환(ADR-006): 유일하게 배선된 live writer trigger가 old(`CollectionReconciliationService`)
 * 에서 new(`CollectionSyncService`)로 바뀌었다 — 스케줄러/관리자 트리거 모두 새 writer만 부른다.
 * old writer는 rollback 참조용 코드로만 provider에 남는다(어떤 controller/scheduler도 더 이상
 * 주입하지 않는다). `CollectionCutoverService`(todo 14 전환 orchestration)는 CLI에서만 실행한다.
 */
@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminGuard,
    CollectionSchedulerService,
    CollectionCanonicalRepository,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionReadService,
    { provide: COLLECTION_READ_PORT, useExisting: CollectionReadService },
    {
      provide: CollectionCutoverService,
      inject: [
        CollectionCanonicalRepository,
        CollectionIncrementalRepository,
        CollectionCutoverRepository,
        CollectionSyncService,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        canonicalRepository: CollectionCanonicalRepository,
        incrementalRepository: CollectionIncrementalRepository,
        cutoverRepository: CollectionCutoverRepository,
        syncService: CollectionSyncService,
        runtimeConfig: RuntimeConfig,
      ): CollectionCutoverService => {
        let tokens: CollectionAppTokenProvider | undefined;
        const resolveGithubOrganizationId = async (): Promise<bigint> => {
          if (!tokens) {
            // Lazy: credentials validated on first cutover run, not module bootstrap.
            const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
            tokens = new CollectionAppTokenProvider(config);
          }
          const identity = await tokens.getInstallationIdentity();
          return BigInt(identity.organizationId);
        };
        const generationImportService = new CollectionGenerationImportService(
          canonicalRepository,
          incrementalRepository,
          resolveGithubOrganizationId,
        );
        return new CollectionCutoverService(
          canonicalRepository,
          generationImportService,
          syncService,
          cutoverRepository,
          () => {
            const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
            return Promise.resolve({
              appId: BigInt(config.appId),
              organizationLogin: config.orgLogin.toLowerCase(),
            });
          },
        );
      },
    },
    {
      provide: CollectionReconciliationService,
      inject: [CollectionCanonicalRepository, RUNTIME_CONFIG],
      useFactory: (
        canonicalRepository: CollectionCanonicalRepository,
        runtimeConfig: RuntimeConfig,
      ): CollectionReconciliationService => {
        let runtime: CollectionReconciliationRuntime | undefined;
        const runtimeFactory: CollectionReconciliationRuntimeFactory = () => {
          if (runtime) return runtime;
          // Lazy: credentials validated on first trigger, not module bootstrap.
          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
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
      provide: CollectionSyncService,
      inject: [CollectionIncrementalRepository, RUNTIME_CONFIG],
      useFactory: (
        incrementalRepository: CollectionIncrementalRepository,
        runtimeConfig: RuntimeConfig,
      ): CollectionSyncService => {
        let runtime: CollectionSyncRuntime | undefined;
        const runtimeFactory: CollectionSyncRuntimeFactory = () => {
          if (runtime) return runtime;
          // Lazy: credentials validated on first run, not module bootstrap.
          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
          const tokens = new CollectionAppTokenProvider(config);
          const queue = new ProviderRequestQueue();
          runtime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens,
            client: new CollectionAppClient(
              config,
              tokens,
              queue.wrapFetcher(globalThis.fetch),
            ),
            queue,
          };
          return runtime;
        };
        return new CollectionSyncService(
          incrementalRepository,
          runtimeFactory,
          async () => {
            const { tokens } = await runtimeFactory();
            const identity = await tokens.getInstallationIdentity();
            return BigInt(identity.organizationId);
          },
        );
      },
    },
  ],
  exports: [COLLECTION_READ_PORT],
})
export class CollectionModule {}
