const DEFAULT_API_URL = 'https://api.github.com/graphql';
const DEFAULT_DEADLINE_MS = 30_000;
const USER_AGENT = 'oss-hub-collection-discovery';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Minimal shape a token provider must satisfy to authenticate discovery
 * requests. Deliberately narrower than `CollectionAppTokenProvider`
 * (`collection-app.token.ts`) — this client must not depend on the
 * Collection App installation token, since whether an installation token
 * can query the top-level `user(login:)` field outside its installation
 * scope is undocumented either way (we deliberately avoid depending on it).
 * `CollectionPublicTokenProvider` (owned by a concurrent lane) is expected
 * to satisfy this shape structurally; `CollectionAppTokenProvider` already
 * does too (same `getToken`/`clear` signatures), but must not be wired
 * here.
 */
export interface CollectionDiscoveryTokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
  clear(expectedToken?: string): void;
}

export interface CollectionDiscoveryClientConfig {
  /** GraphQL endpoint. Defaults to `https://api.github.com/graphql`. */
  readonly apiUrl?: string;
  /**
   * Passed verbatim as the `maxRepositories` GraphQL argument. GitHub's
   * schema default is 25 — this client requires an explicit value rather
   * than silently relying on that default. The true upper bound is
   * undocumented (community reports, unverified, suggest values up to
   * ~100 are accepted); if GitHub rejects the configured value, the error
   * surfaces to the caller rather than being silently retried lower.
   */
  readonly maxRepositories: number;
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

export interface CollectionDiscoveryRepository {
  readonly databaseId: string;
  readonly nameWithOwner: string;
  readonly ownerLogin: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
}

export interface CollectionDiscoveryResult {
  readonly repositories: CollectionDiscoveryRepository[];
  /**
   * Count of contributions GitHub attributes to private repositories in
   * the requested window. Private contributions are only ever exposed
   * through this aggregate — `contributionsCollection` never lists a
   * private repository in the per-repository breakdown fields
   * (`commitContributionsByRepository`,
   * `pullRequestReviewContributionsByRepository`). That is the API-level
   * guarantee that this client only ever sees public repositories; the
   * `isPrivate` filter below is a defensive belt-and-suspenders check on
   * top of it, not the primary mechanism.
   */
  readonly restrictedContributionsCount: number;
}

/**
 * Person-axis (not repository-axis) activity observation for one GitHub
 * login. `starCount` is cumulative across the account's public owned
 * repositories, not "stars earned in the window".
 */
export interface CollectionUserActivityMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

interface RawRepository {
  readonly databaseId: string;
  readonly nameWithOwner: string;
  readonly ownerLogin: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly isPrivate: boolean;
}

const REPOSITORY_FIELDS = `
    databaseId
    nameWithOwner
    isPrivate
    isArchived
    defaultBranchRef { name }
    owner { login }
`;

/**
 * Discovery-only query: returns repository identities a user contributed
 * commits or pull request reviews to within `[from, to)`, plus the
 * restricted (private) contribution count. Deliberately does not fetch
 * commit/PR/release facts — `CollectionAppClient`
 * (`collection-app.client.ts`) remains the sole fact collector.
 */
const DISCOVERY_QUERY = `
  query CollectionDiscovery($login: String!, $from: DateTime!, $to: DateTime!, $max: Int!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        commitContributionsByRepository(maxRepositories: $max) {
          repository {
${REPOSITORY_FIELDS}
          }
        }
        pullRequestReviewContributionsByRepository(maxRepositories: $max) {
          repository {
${REPOSITORY_FIELDS}
          }
        }
      }
    }
  }
`;

/**
 * Person-axis activity query: one call answers "how much did this person do
 * in `[from, to)`" without going through any repository we track. The
 * window MUST be at most one year — GitHub rejects a longer
 * `contributionsCollection(from, to)` span with a hard `VALIDATION` GraphQL
 * error (verified against the live API, `docs/rules/data-modeling.md` §5),
 * so callers never widen it and this client never splits/retries it.
 *
 * `repositories(ownerAffiliations: OWNER, privacy: PUBLIC)` is paginated:
 * star totals are summed across pages while `pageInfo.hasNextPage` holds.
 * The contribution counters are read from the first page only — they do not
 * depend on the repository cursor, and re-reading them per page would let a
 * mid-pagination change silently double-count.
 */
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

/**
 * Upper bound on `repositories` pages walked for one user. 100 nodes per
 * page × 50 pages = 5,000 owned public repositories, far above any
 * plausible student account; the bound exists so a server-side cursor bug
 * cannot spin this loop forever.
 */
const MAX_ACTIVITY_PAGES = 50;

function dedupeByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(item);
  }
  return result;
}

/**
 * External-repository discovery client (GraphQL, discovery only). Returns
 * a list of repository identities a GitHub user contributed to over a
 * date window — this is the only official API shape that can answer that
 * question (see module docs / exec-plan for why REST cannot: `/search/
 * commits` only searches a repo's default branch and is capped at 30 req/
 * min, `/users/{u}/events/public` is retained 30 days, and `/user/repos`
 * returns only the caller's own repos).
 *
 * Mirrors the structure and conventions of `CollectionAppClient`
 * (`collection-app.client.ts`): raw `fetch` via an injectable `Fetcher`,
 * no GraphQL library, typed errors, constructor-injected config/token
 * provider. GraphQL has its own rate-limit bucket, separate from REST's.
 */
export class CollectionDiscoveryClient {
  constructor(
    private readonly config: CollectionDiscoveryClientConfig,
    private readonly tokens: CollectionDiscoveryTokenProvider,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async discoverContributedRepositories(
    login: string,
    from: string,
    to: string,
  ): Promise<CollectionDiscoveryResult> {
    const body = await this.request({
      query: DISCOVERY_QUERY,
      variables: { login, from, to, max: this.config.maxRepositories },
    });
    const data = this.record(body.data);
    const user = data.user;
    if (user === null || user === undefined) {
      throw new CollectionDiscoveryClientError('USER_NOT_FOUND');
    }
    const collection = this.record(this.record(user).contributionsCollection);
    const restrictedContributionsCount = this.count(
      collection.restrictedContributionsCount,
    );
    const raw = dedupeByKey(
      [
        ...this.repositoryList(collection.commitContributionsByRepository),
        ...this.repositoryList(
          collection.pullRequestReviewContributionsByRepository,
        ),
      ],
      (r) => r.databaseId,
    );
    const repositories: CollectionDiscoveryRepository[] = raw
      .filter((r) => !r.isPrivate)
      .map((r) => ({
        databaseId: r.databaseId,
        nameWithOwner: r.nameWithOwner,
        ownerLogin: r.ownerLogin,
        defaultBranch: r.defaultBranch,
        archived: r.archived,
      }));
    return { repositories, restrictedContributionsCount };
  }

  /**
   * Person-axis activity metrics for one GitHub login over `[from, to)`.
   *
   * `from`/`to` must span at most one year (see `USER_ACTIVITY_QUERY`); a
   * wider window is rejected upstream and surfaces as `GRAPHQL_ERROR`.
   * `starCount` is a lifetime cumulative figure — GitHub does not expose
   * "stars earned this year" cheaply — and is summed across every
   * `repositories` page.
   */
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
        // GitHub returns `null` nodes for entries the token cannot see;
        // they carry no star fact, so they are skipped rather than
        // treated as a malformed page.
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
      // GraphQL reports failure as HTTP 200 with a top-level `errors`
      // array (sometimes alongside partial/null `data`). Treating 200 as
      // success regardless would let a real failure look identical to
      // "no contributions" and silently zero out a student's ranking.
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

  private repositoryList(container: unknown): RawRepository[] {
    if (!Array.isArray(container)) this.invalid();
    const result: RawRepository[] = [];
    for (const edge of container) {
      const repository = this.record(edge).repository;
      if (repository === null || repository === undefined) continue;
      result.push(this.repository(repository));
    }
    return result;
  }

  private repository(v: unknown): RawRepository {
    const r = this.record(v);
    const owner = this.record(r.owner);
    const branch = r.defaultBranchRef;
    return {
      databaseId: this.id(r.databaseId),
      nameWithOwner: this.string(r.nameWithOwner),
      ownerLogin: this.string(owner.login),
      defaultBranch:
        branch === null || branch === undefined
          ? null
          : this.string(this.record(branch).name),
      archived: this.boolean(r.isArchived),
      isPrivate: this.boolean(r.isPrivate),
    };
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

  private id(v: unknown): string {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) {
      return String(v);
    }
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
