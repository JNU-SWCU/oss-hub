const DEFAULT_API_URL = 'https://api.github.com/graphql';
const DEFAULT_DEADLINE_MS = 30_000;
const USER_AGENT = 'oss-hub-collection-discovery';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CollectionDiscoveryTokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
  clear(expectedToken?: string): void;
}

export interface CollectionDiscoveryClientConfig {
  readonly apiUrl?: string;
  readonly deadlineMs?: number;
}

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

export interface CollectionUserActivityMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

const USER_ACTIVITY_QUERY = `
  query CollectionUserActivity($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    rateLimit {
      cost
      remaining
    }
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalRepositoryContributions
      }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, after: $after) {
        totalCount
        nodes {
          stargazerCount
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const MAX_ACTIVITY_PAGES = 50;

export class CollectionDiscoveryClient {
  constructor(
    private readonly config: CollectionDiscoveryClientConfig,
    private readonly tokens: CollectionDiscoveryTokenProvider,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async fetchUserActivityMetrics(
    login: string,
    from: string,
    to: string,
  ): Promise<CollectionUserActivityMetrics> {
    let counts: {
      commitCount: number;
      pullRequestCount: number;
      issueCount: number;
      repositoryCount: number;
    } | null = null;
    let starCount = 0;
    let after: string | null = null;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_ACTIVITY_PAGES) {
        throw new CollectionDiscoveryClientError('RESPONSE');
      }
      const body = await this.request({
        query: USER_ACTIVITY_QUERY,
        variables: { login, from, to, after },
      });
      const user = this.record(body.data).user;
      if (user === null || user === undefined) {
        throw new CollectionDiscoveryClientError('USER_NOT_FOUND');
      }
      const record = this.record(user);
      if (counts === null) {
        const collection = this.record(record.contributionsCollection);
        counts = {
          commitCount: this.count(collection.totalCommitContributions),
          pullRequestCount: this.count(
            collection.totalPullRequestContributions,
          ),
          issueCount: this.count(collection.totalIssueContributions),
          repositoryCount: this.count(collection.totalRepositoryContributions),
        };
      }
      const repositories = this.record(record.repositories);
      const nodes = repositories.nodes;
      if (!Array.isArray(nodes)) this.invalid();
      for (const node of nodes) {
        if (node === null || node === undefined) continue;
        starCount += this.count(this.record(node).stargazerCount);
      }
      const pageInfo = this.record(repositories.pageInfo);
      if (!this.boolean(pageInfo.hasNextPage)) break;
      after = this.string(pageInfo.endCursor);
    }
    return { ...counts, starCount };
  }

  private async request(payload: {
    query: string;
    variables: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const deadlineMs = this.config.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const deadline = this.now() + deadlineMs;
    const url = this.config.apiUrl ?? DEFAULT_API_URL;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new CollectionDiscoveryClientError('DEADLINE');
      const signal = AbortSignal.timeout(Math.max(1, remaining));
      const token = await this.tokens.getToken(signal);
      if (deadline - this.now() <= 0)
        throw new CollectionDiscoveryClientError('DEADLINE');
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(payload),
          signal,
        });
      } catch {
        if (this.now() >= deadline)
          throw new CollectionDiscoveryClientError('DEADLINE');
        throw new CollectionDiscoveryClientError('UPSTREAM');
      }
      if (response.status === 401) {
        if (attempt === 0) {
          this.tokens.clear(token);
          continue;
        }
        throw new CollectionDiscoveryClientError('AUTH');
      }
      if (!response.ok) {
        if (
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')))
        ) {
          throw new CollectionDiscoveryClientError(
            'RATE_LIMITED',
            this.retryAfter(response.headers),
          );
        }
        throw new CollectionDiscoveryClientError('UPSTREAM');
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new CollectionDiscoveryClientError('RESPONSE');
      }
      const body = this.record(json);

      if (Array.isArray(body.errors) && body.errors.length > 0) {
        const rateLimited = body.errors.some(
          (e) => this.isRecord(e) && e.type === 'RATE_LIMITED',
        );
        throw new CollectionDiscoveryClientError(
          rateLimited ? 'RATE_LIMITED' : 'GRAPHQL_ERROR',
        );
      }
      return body;
    }
    throw new CollectionDiscoveryClientError('AUTH');
  }

  private retryAfter(headers: Headers): number | undefined {
    const value = headers.get('retry-after');
    if (!value) return undefined;
    if (/^\d+$/.test(value)) return Number(value);
    const date = Date.parse(value);
    return Number.isFinite(date)
      ? Math.max(0, Math.ceil((date - this.now()) / 1000))
      : undefined;
  }

  private isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  private record(v: unknown): Record<string, unknown> {
    if (this.isRecord(v)) return v;
    return this.invalid();
  }

  private count(v: unknown): number {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
    return this.invalid();
  }

  private string(v: unknown): string {
    if (typeof v === 'string' && v.length > 0) return v;
    return this.invalid();
  }

  private boolean(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    return this.invalid();
  }

  private invalid(): never {
    throw new CollectionDiscoveryClientError('RESPONSE');
  }
}
