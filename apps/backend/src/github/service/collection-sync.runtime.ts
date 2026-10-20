import type {
  CollectionAppClient,
  CollectionAppClientTokenProvider,
} from '../gateway/collection-app.client';
import type { ProviderRequestQueue } from '../gateway/collection-provider-queue';

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;

  tokens: CollectionAppClientTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueue;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;
