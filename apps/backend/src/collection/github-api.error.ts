export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError';

  constructor(public readonly retryNotBeforeAt: Date) {
    super('GitHub API rate limit exceeded');
  }
}

export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';

  constructor(public readonly statusCode: number) {
    super(`GitHub API request failed with status ${statusCode}`);
  }
}

export class UpstreamResponseError extends Error {
  override readonly name = 'UpstreamResponseError';

  constructor() {
    super('GitHub API response format is invalid');
  }
}
