import type { RuntimeConfig } from '../platform/runtime-config.config';
import {
  CollectionPublicReadConfig,
  CollectionAppConfig,
} from './collection-app.config';
import type { Provider } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppTokenProvider } from './collection-app-token.client';
import {
  CollectionDiscoveryClient,
  ProviderRequestQueue,
} from './collection-discovery.client';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { CollectionUserActivityService } from './collection-user-activity.service';
import {
  CollectionSyncRuntime,
  CollectionSyncRuntimeFactory,
  CollectionSyncService,
} from './collection-sync.service';

export class CollectionPublicTokenProvider {
  private token: string | undefined;

  constructor(private readonly runtimeConfig: RuntimeConfig) {}

  getToken(): Promise<string> {
    if (this.token !== undefined) return Promise.resolve(this.token);
    try {
      const config = CollectionPublicReadConfig.fromRuntimeConfig(
        this.runtimeConfig,
      );
      this.token = config.token;
      return Promise.resolve(this.token);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  clear(): void {}
}

export const collectionProviders: Provider[] = [
  {
    provide: CollectionPublicTokenProvider,
    inject: [RUNTIME_CONFIG],
    useFactory: (runtimeConfig: RuntimeConfig): CollectionPublicTokenProvider =>
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
    inject: [CollectionUserActivityRepository, CollectionDiscoveryClient],
    useFactory: (
      userActivityRepository: CollectionUserActivityRepository,
      discoveryClient: CollectionDiscoveryClient,
    ): CollectionUserActivityService =>
      new CollectionUserActivityService(
        userActivityRepository,
        discoveryClient,
      ),
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
];
