import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppConfig } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
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
 * C2 retirement(#151, ADR-006): Collection authority는 installation token 기반
 * REST reconciliation 하나뿐이다. webhook ingress·OAuth/PAT 수집·legacy batch
 * runtime은 제거되었고, legacy 관측 테이블은 호환 릴리스 동안 inert로만 남는다(M3).
 */
@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminGuard,
    CollectionSchedulerService,
    CollectionCanonicalRepository,
    CollectionIncrementalRepository,
    CollectionReadService,
    { provide: COLLECTION_READ_PORT, useExisting: CollectionReadService },
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
