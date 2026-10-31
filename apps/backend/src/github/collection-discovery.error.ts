export type CollectionDiscoveryErrorKind =
  | 'UPSTREAM'
  | 'RESPONSE'
  | 'DEADLINE'
  | 'RATE_LIMITED'
  | 'AUTH'
  | 'GRAPHQL_ERROR'
  | 'USER_NOT_FOUND';

export class CollectionDiscoveryClientError extends Error {
  readonly code = 'COLLECTION_DISCOVERY_CLIENT_ERROR';
  constructor(
    readonly kind: CollectionDiscoveryErrorKind,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Collection discovery request failed: ${kind}`);
    this.name = 'CollectionDiscoveryClientError';
  }
}
