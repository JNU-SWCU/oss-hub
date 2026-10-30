export type CollectionAppErrorKind =
  | 'UPSTREAM'
  | 'RESPONSE'
  | 'PAGINATION'
  | 'DEADLINE'
  | 'RATE_LIMITED'
  | 'AUTH'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'GRAPHQL_ERROR';

export class CollectionAppClientError extends Error {
  readonly code = 'COLLECTION_APP_CLIENT_ERROR';
  constructor(
    readonly kind: CollectionAppErrorKind,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Collection App request failed: ${kind}`);
    this.name = 'CollectionAppClientError';
  }
}
