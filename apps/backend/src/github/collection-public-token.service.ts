import type { RuntimeConfig } from '../platform/runtime-config.config';
import {
  CollectionAppConfig,
  CollectionPublicReadConfig,
} from './collection-app.config';
import { Inject, Injectable, type Provider } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppTokenClient } from './collection-app-token.client';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import {
  CollectionIncrementalRepository,
  type CollectionSyncRuntime,
  type CollectionSyncRuntimeFactory,
} from './collection-incremental.repository';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { CollectionUserActivityService } from './collection-user-activity.service';
import { CollectionSyncService } from './collection-sync.service';
import { ProviderRequestQueueClient } from './provider-request-queue.client';
import { RepositoryUrlService } from './repository-url.service';

@Injectable()
export class CollectionPublicTokenService {
  private token: string | undefined;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtimeConfig: RuntimeConfig,
  ) {}

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

export const COLLECTION_PROVIDERS: Provider[] = [
  CollectionPublicTokenService,
  {
    provide: CollectionDiscoveryClient,
    inject: [CollectionPublicTokenService],
    useFactory: (
      tokens: CollectionPublicTokenService,
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
      CollectionPublicTokenService,
      RepositoryUrlService,
    ],
    useFactory: (
      incrementalRepository: CollectionIncrementalRepository,
      runtimeConfig: RuntimeConfig,
      publicTokens: CollectionPublicTokenService,
      repositoryUrl: RepositoryUrlService,
    ): CollectionSyncService => {
      let orgTokens: CollectionAppTokenClient | undefined;
      let runtime: CollectionSyncRuntime | undefined;
      const runtimeFactory: CollectionSyncRuntimeFactory = () => {
        if (runtime) return runtime;

        const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
        orgTokens = new CollectionAppTokenClient(config);
        const queue = new ProviderRequestQueueClient();
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
          orgTokens = new CollectionAppTokenClient(config);
        }
        const identity = await orgTokens.getInstallationIdentity();
        return BigInt(identity.organizationId);
      };

      let externalRuntime: CollectionSyncRuntime | undefined;
      const externalRuntimeFactory: CollectionSyncRuntimeFactory = () => {
        if (externalRuntime) return externalRuntime;
        const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
        const queue = new ProviderRequestQueueClient();
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
        repositoryUrl,
        undefined,
        undefined,
        externalRuntimeFactory,
      );
    },
  },
];
