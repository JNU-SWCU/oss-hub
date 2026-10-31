export class CollectionAppTokenError extends Error {
  readonly code = 'COLLECTION_APP_TOKEN_INVALID';
  constructor(
    readonly safeReason:
      'AUTH' | 'UPSTREAM' | 'INSTALLATION' | 'PERMISSIONS' | 'RESPONSE',
  ) {
    super(`Collection App token unavailable: ${safeReason}`);
    this.name = 'CollectionAppTokenError';
  }
}
