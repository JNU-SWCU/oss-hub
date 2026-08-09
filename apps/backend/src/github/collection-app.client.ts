import { CollectionAppConfigValues } from './collection-app.config';
import {
  PullRequestFrontier,
  ReleaseFrontier,
  RequestFingerprint,
} from './collection-app.frontier';

const API_VERSION = '2022-11-28';
const ACCEPT = 'application/vnd.github+json';
/**
 * GraphQL endpoint default. Deliberately separate from
 * `CollectionAppConfigValues.apiBaseUrl` (a REST base): GitHub serves
 * GraphQL from a single `/graphql` endpoint, not from a path under the
 * REST base. Overridable via `CollectionAppConfigValues.graphqlUrl`,
 * mirroring `CollectionDiscoveryClientConfig.apiUrl`.
 */
const DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql';
const USER_AGENT = 'oss-hub-collection-app';

/** login → GraphQL node ID. `history(author:{id:})` takes a node ID. */
const USER_NODE_ID_QUERY = `
  query CollectionUserNodeId($login: String!) {
    user(login: $login) { id }
  }
`;

/**
 * Author-filtered default-branch history. The `author: { id: $authorId }`
 * argument is the whole point of this path: REST `/repos/{o}/{r}/commits`
 * has no server-side author filter that GitHub bills cheaply, so the REST
 * path must page the entire branch history (e.g. ~217 requests for
 * `facebook/react`) to find one user's commits, while this returns only
 * that user's commits — typically a single request costing 1 rate-limit
 * point.
 */
const AUTHOR_COMMIT_HISTORY_QUERY = `
  query CollectionAuthorCommits($owner: String!, $name: String!, $branch: String!, $authorId: ID!, $since: GitTimestamp, $cursor: String) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $branch) {
        target {
          ... on Commit {
            history(first: 100, author: { id: $authorId }, since: $since, after: $cursor) {
              nodes {
                oid
                committedDate
                commitUrl
                author { user { databaseId login } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }
  }
`;

/**
 * 저장소 default branch의 **전체** 커밋 수. 노드를 하나도 받지 않고 `totalCount`만 읽어
 * 비용을 최소로 유지한다(작성자 필터 없음 — 팀원·외부 기여자를 모두 포함한 총량).
 * `first`를 주지 않는다 — `first`는 페이지 크기일 뿐 `totalCount`와 무관하므로
 * (`first: 1`이어도 총계는 그대로다) 붙이면 "커밋을 받는다"고 오해를 부른다.
 * `외부 기여 = 전체 − 팀원합` 계산의 좌변이며, 개인 식별자는 어떤 필드로도 요청하지 않는다.
 */
const DEFAULT_BRANCH_COMMIT_COUNT_QUERY = `
  query CollectionDefaultBranchCommitCount($owner: String!, $name: String!, $branch: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $branch) {
        target {
          ... on Commit {
            history { totalCount }
          }
        }
      }
    }
  }
`;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Minimal shape a token provider must satisfy to authenticate Collection
 * App requests. Deliberately narrower than `CollectionAppTokenProvider`
 * (`collection-app.token.ts`) — TS treats that class nominally (private
 * fields), so a structurally-identical but differently-declared provider
 * (e.g. `CollectionPublicTokenProvider`, `collection-public.token.ts`) can
 * never satisfy the class type, only this narrower structural shape.
 * Mirrors `CollectionDiscoveryTokenProvider`
 * (`collection-discovery.client.ts:19-22`) for the identical reason. Both
 * `CollectionAppTokenProvider` and `CollectionPublicTokenProvider` already
 * provide this exact `getToken`/`clear` shape.
 */
export interface CollectionAppClientTokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
  clear(expectedToken?: string): void;
}

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

export interface CollectionRepository {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  ownerLogin: string;
  htmlUrl: string;
  updatedAt: string;
}
export interface CollectionCommit {
  sha: string;
  authorLogin: string | null;
  authorGithubId: string | null;
  committedAt: string;
  htmlUrl: string;
}
export interface CollectionPullRequest {
  id: string;
  number: number;
  state: 'open' | 'closed';
  draft: boolean;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
  authorGithubId: string | null;
  htmlUrl: string;
}
export interface CollectionRelease {
  id: string;
  tagName: string;
  name: string | null;
  publishedAt: string;
  authorLogin: string | null;
  authorGithubId: string | null;
  htmlUrl: string;
}

/**
 * Result of a lightweight (`per_page=1`) default-branch head probe. When
 * `changed` is `false` the conditional GET returned `304` against the
 * supplied ETag and no further request is needed. `headSha` is `null` for
 * an empty repository.
 */
export type CommitHeadProbeResult =
  | { changed: false; fingerprint: RequestFingerprint; etag: string }
  | {
      changed: true;
      headSha: string | null;
      fingerprint: RequestFingerprint;
      etag: string | null;
    };

/**
 * Result of traversing the default branch newest-to-oldest until a known
 * SHA is met. `disconnectedFullScan` is `true` only when pagination reached
 * the true end of the branch history without ever meeting a known SHA
 * (including the first-ever backfill, where `knownShas` is empty) — the
 * caller may promote the frontier only when this is `true` or a known SHA
 * was met.
 */
export interface CommitTraversalResult {
  commits: CollectionCommit[];
  disconnectedFullScan: boolean;
  fingerprint: RequestFingerprint;
}

/**
 * Result of reading pull requests strictly newer than `(createdAt, id)`.
 * `newFrontier` is the frontier to persist for the next call; it equals the
 * input frontier when nothing new was found.
 */
export interface PullRequestIncrementalResult {
  pullRequests: CollectionPullRequest[];
  newFrontier: PullRequestFrontier | null;
  fingerprint: RequestFingerprint;
}

/** Result of a lightweight (`per_page=1`) latest-release probe. */
export type ReleaseProbeResult =
  | { changed: false; fingerprint: RequestFingerprint; etag: string }
  | {
      changed: true;
      frontier: ReleaseFrontier | null;
      fingerprint: RequestFingerprint;
      etag: string | null;
    };

/** Complete published-release listing, deduped by stable release ID. */
export interface ReleaseListingResult {
  releases: CollectionRelease[];
  fingerprint: RequestFingerprint;
}

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

export class CollectionAppClient {
  constructor(
    private readonly config: CollectionAppConfigValues,
    private readonly tokens: CollectionAppClientTokenProvider,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  listInstallationRepositories(): Promise<CollectionRepository[]> {
    return this.pages(
      '/installation/repositories?per_page=100',
      (v) => this.repository(v),
      'repositories',
    );
  }

  async getRepository(
    owner: string,
    repo: string,
  ): Promise<CollectionRepository> {
    return this.repository(
      await this.one(`/repos/${this.segment(owner)}/${this.segment(repo)}`),
    );
  }

  listDefaultBranchCommits(
    owner: string,
    repo: string,
    defaultBranch: string,
  ): Promise<CollectionCommit[]> {
    return this.pages(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=100`,
      (v) => this.commit(v),
      undefined,
      true,
    );
  }

  /**
   * Resolves a GitHub login to its GraphQL node ID, or `null` when no such
   * user exists. `history(author: { id: })` matches on the node ID, not the
   * REST `databaseId`, so this is the required first step of
   * {@link listDefaultBranchCommitsByAuthor}.
   */
  async resolveUserNodeId(login: string): Promise<string | null> {
    const body = await this.graphql({
      query: USER_NODE_ID_QUERY,
      variables: { login },
    });
    const user = this.record(body.data).user;
    if (user === null || user === undefined) return null;
    return this.string(this.record(user).id);
  }

  /**
   * Default-branch commits authored by exactly one user, newest-to-oldest,
   * optionally bounded below by `since` (ISO-8601). Returns the same
   * `CollectionCommit[]` shape as {@link listDefaultBranchCommits} so the
   * two are interchangeable at the call site; an unknown branch (`ref`
   * resolves to `null`) yields an empty array. Paging is capped by
   * `config.maxPages`, the same bound the REST traversal uses.
   */
  async listDefaultBranchCommitsByAuthor(
    owner: string,
    repo: string,
    defaultBranch: string,
    authorNodeId: string,
    since?: string,
  ): Promise<CollectionCommit[]> {
    const deadline = this.now() + this.config.deadlineMs;
    const commits: CollectionCommit[] = [];
    let cursor: string | null = null;
    for (let page = 0; ; page += 1) {
      if (page >= this.config.maxPages)
        throw new CollectionAppClientError('PAGINATION');
      const body = await this.graphql(
        {
          query: AUTHOR_COMMIT_HISTORY_QUERY,
          variables: {
            owner,
            name: repo,
            branch: defaultBranch,
            authorId: authorNodeId,
            since: since ?? null,
            cursor,
          },
        },
        deadline,
      );
      const repository = this.record(body.data).repository;
      if (repository === null || repository === undefined) this.invalid();
      const ref = this.record(repository).ref;
      const target =
        ref === null || ref === undefined ? null : this.record(ref).target;
      if (target === null || target === undefined) {
        // Branch (or its commit target) does not exist. Only meaningful on
        // the first page — disappearing mid-pagination would silently
        // truncate history, so treat that as a malformed response.
        if (page > 0) this.invalid();
        return [];
      }
      const history = this.record(this.record(target).history);
      const nodes = history.nodes;
      if (!Array.isArray(nodes)) this.invalid();
      for (const node of nodes) commits.push(this.historyCommit(node));
      const pageInfo = this.record(history.pageInfo);
      if (!this.boolean(pageInfo.hasNextPage)) break;
      cursor = this.string(pageInfo.endCursor);
    }
    return dedupeByKey(commits, (commit) => commit.sha);
  }

  /**
   * Total default-branch commit count (every author), or `null` when the
   * branch — or its commit target — does not exist. `null` is deliberately
   * distinct from `0`: "the branch has no commits" and "there is no branch"
   * are different facts, and subtracting a team total from the latter would
   * produce a negative external-contributor figure. Costs one rate-limit
   * point and transfers no commit nodes at all.
   */
  async countDefaultBranchCommits(
    owner: string,
    repo: string,
    defaultBranch: string,
  ): Promise<number | null> {
    const body = await this.graphql({
      query: DEFAULT_BRANCH_COMMIT_COUNT_QUERY,
      variables: { owner, name: repo, branch: defaultBranch },
    });
    const repository = this.record(body.data).repository;
    if (repository === null || repository === undefined) this.invalid();
    const ref = this.record(repository).ref;
    const target =
      ref === null || ref === undefined ? null : this.record(ref).target;
    if (target === null || target === undefined) return null;
    const history = this.record(this.record(target).history);
    return this.count(history.totalCount);
  }

  listPullRequests(
    owner: string,
    repo: string,
  ): Promise<CollectionPullRequest[]> {
    return this.pages(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/pulls?state=all&per_page=100`,
      (v) => this.pullRequest(v),
    );
  }

  async listPublishedReleases(
    owner: string,
    repo: string,
  ): Promise<CollectionRelease[]> {
    const releases = (
      await this.pages(
        `/repos/${this.segment(owner)}/${this.segment(repo)}/releases?per_page=100`,
        (v) => {
          const r = this.record(v);
          if (typeof r.draft !== 'boolean' || typeof r.prerelease !== 'boolean')
            this.invalid();
          return r.draft ? null : this.release(r);
        },
      )
    ).filter((release): release is CollectionRelease => release !== null);
    return dedupeByKey(releases, (release) => release.id);
  }

  /**
   * Static default-branch head probe (`per_page=1`, conditional GET). The
   * caller compares the previous frontier's ETag/SHA against this result and
   * only invokes {@link listCommitsUntilKnownSha} when it actually changed.
   */
  async probeDefaultBranchHead(
    owner: string,
    repo: string,
    defaultBranch: string,
    previousEtag: string | null,
  ): Promise<CommitHeadProbeResult> {
    const fingerprint = this.commitFingerprint(owner, repo, defaultBranch, 1);
    const response = await this.conditionalOne(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1`,
      previousEtag,
      true,
    );
    if (response.notModified) {
      if (!response.etag) this.invalid();
      return { changed: false, fingerprint, etag: response.etag };
    }
    if (!Array.isArray(response.body)) this.invalid();
    const headSha =
      response.body.length === 0
        ? null
        : this.string(this.record(response.body[0]).sha);
    return { changed: true, headSha, fingerprint, etag: response.etag };
  }

  /**
   * Reads the default branch newest-to-oldest until any SHA in `knownShas`
   * is met, deduping by SHA. When no known SHA intersects, pagination
   * continues to the true end of the branch history (exceptional recovery
   * scan for a disconnected history) rather than stopping early.
   */
  async listCommitsUntilKnownSha(
    owner: string,
    repo: string,
    defaultBranch: string,
    knownShas: ReadonlySet<string>,
  ): Promise<CommitTraversalResult> {
    const fingerprint = this.commitFingerprint(owner, repo, defaultBranch, 100);
    const { items, exhausted } = await this.traverseUntil(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=100`,
      (raw) => knownShas.has(this.string(this.record(raw).sha)),
      (v) => this.commit(v),
      undefined,
      true,
    );
    return {
      commits: dedupeByKey(items, (commit) => commit.sha),
      disconnectedFullScan: exhausted,
      fingerprint,
    };
  }

  /**
   * Reads pull requests `state=all&sort=created&direction=desc` until the
   * `(createdAt, githubPullRequestId)` tie frontier is met, deduping by ID.
   * A `null` frontier reads every pull request (first-ever backfill).
   */
  async listNewPullRequests(
    owner: string,
    repo: string,
    tieFrontier: PullRequestFrontier | null,
  ): Promise<PullRequestIncrementalResult> {
    const fingerprint = this.pullRequestFingerprint(owner, repo);
    const { items } = await this.traverseUntil(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/pulls?state=all&sort=created&direction=desc&per_page=100`,
      (raw) =>
        tieFrontier !== null &&
        this.isAtOrBeforePullRequestFrontier(raw, tieFrontier),
      (v) => this.pullRequest(v),
    );
    const pullRequests = dedupeByKey(items, (pr) => pr.id);
    const newFrontier = pullRequests[0]
      ? { createdAt: pullRequests[0].createdAt, id: pullRequests[0].id }
      : tieFrontier;
    return { pullRequests, newFrontier, fingerprint };
  }

  /**
   * Static latest-release probe (`per_page=1`, conditional GET). The caller
   * only invokes {@link listChangedPublishedReleases} when this changed.
   */
  async probeLatestRelease(
    owner: string,
    repo: string,
    previousEtag: string | null,
  ): Promise<ReleaseProbeResult> {
    const fingerprint = this.releaseProbeFingerprint(owner, repo);
    const response = await this.conditionalOne(
      `/repos/${this.segment(owner)}/${this.segment(repo)}/releases?per_page=1`,
      previousEtag,
    );
    if (response.notModified) {
      if (!response.etag) this.invalid();
      return { changed: false, fingerprint, etag: response.etag };
    }
    if (!Array.isArray(response.body)) this.invalid();
    const frontier =
      response.body.length === 0
        ? null
        : this.releaseFrontier(this.record(response.body[0]));
    return { changed: true, frontier, fingerprint, etag: response.etag };
  }

  /**
   * Complete published-release pagination for a repository whose probe
   * changed, deduped by stable release ID. Reuses {@link listPublishedReleases}
   * so a previously-draft release that has since published is included.
   */
  async listChangedPublishedReleases(
    owner: string,
    repo: string,
  ): Promise<ReleaseListingResult> {
    return {
      releases: await this.listPublishedReleases(owner, repo),
      fingerprint: this.releaseListFingerprint(owner, repo),
    };
  }

  private commitFingerprint(
    owner: string,
    repo: string,
    ref: string,
    pageSize: number,
  ): RequestFingerprint {
    return {
      endpoint: `/repos/${owner}/${repo}/commits`,
      ref,
      query: `per_page=${pageSize}`,
      order: null,
      pageSize,
      accept: ACCEPT,
      apiVersion: API_VERSION,
    };
  }

  private pullRequestFingerprint(
    owner: string,
    repo: string,
  ): RequestFingerprint {
    return {
      endpoint: `/repos/${owner}/${repo}/pulls`,
      ref: null,
      query: 'state=all',
      order: 'sort=created&direction=desc',
      pageSize: 100,
      accept: ACCEPT,
      apiVersion: API_VERSION,
    };
  }

  private releaseProbeFingerprint(
    owner: string,
    repo: string,
  ): RequestFingerprint {
    return {
      endpoint: `/repos/${owner}/${repo}/releases`,
      ref: null,
      query: 'per_page=1',
      order: null,
      pageSize: 1,
      accept: ACCEPT,
      apiVersion: API_VERSION,
    };
  }

  private releaseListFingerprint(
    owner: string,
    repo: string,
  ): RequestFingerprint {
    return {
      endpoint: `/repos/${owner}/${repo}/releases`,
      ref: null,
      query: 'per_page=100',
      order: null,
      pageSize: 100,
      accept: ACCEPT,
      apiVersion: API_VERSION,
    };
  }

  private isAtOrBeforePullRequestFrontier(
    raw: unknown,
    frontier: PullRequestFrontier,
  ): boolean {
    const r = this.record(raw);
    const createdAt = this.date(r.created_at);
    if (createdAt !== frontier.createdAt) {
      return Date.parse(createdAt) < Date.parse(frontier.createdAt);
    }
    return BigInt(this.id(r.id)) <= BigInt(frontier.id);
  }

  private releaseFrontier(r: Record<string, unknown>): ReleaseFrontier {
    if (typeof r.draft !== 'boolean') this.invalid();
    return {
      probe: `${this.id(r.id)}:${r.draft}:${r.published_at === null ? 'null' : this.string(r.published_at)}`,
    };
  }

  private async one(path: string): Promise<unknown> {
    const deadline = this.now() + this.config.deadlineMs;
    return (
      await this.request(
        new URL(path, `${this.config.apiBaseUrl}/`).toString(),
        deadline,
      )
    ).body;
  }

  private async conditionalOne(
    path: string,
    ifNoneMatch: string | null,
    emptyRepositoryIsEmpty = false,
  ): Promise<{ body: unknown; etag: string | null; notModified: boolean }> {
    const deadline = this.now() + this.config.deadlineMs;
    return this.request(
      new URL(path, `${this.config.apiBaseUrl}/`).toString(),
      deadline,
      { emptyRepositoryIsEmpty, ifNoneMatch },
    );
  }

  private async pages<T>(
    path: string,
    normalize: (value: unknown) => T,
    envelope?: string,
    emptyRepositoryIsEmpty = false,
  ): Promise<T[]> {
    return (
      await this.traverseUntil(
        path,
        () => false,
        normalize,
        envelope,
        emptyRepositoryIsEmpty,
      )
    ).items;
  }

  /**
   * Pages through `path` until either `shouldStop` reports the current raw
   * item as already-known (returns collected items so far, `exhausted:
   * false`) or pagination reaches the true end of the list (`exhausted:
   * true`) — the only two states from which a caller may promote a
   * frontier. Hitting the page limit without either is a `PAGINATION`
   * error, never a silent "exhausted".
   */
  private async traverseUntil<T>(
    path: string,
    shouldStop: (raw: unknown) => boolean,
    normalize: (value: unknown) => T,
    envelope?: string,
    emptyRepositoryIsEmpty = false,
  ): Promise<{ items: T[]; exhausted: boolean }> {
    const deadline = this.now() + this.config.deadlineMs;
    const result: T[] = [];
    const seen = new Set<string>();
    let next: string | null = new URL(
      path,
      `${this.config.apiBaseUrl}/`,
    ).toString();
    for (let page = 0; next; page += 1) {
      if (page >= this.config.maxPages)
        throw new CollectionAppClientError('PAGINATION');
      if (seen.has(next)) throw new CollectionAppClientError('PAGINATION');
      seen.add(next);
      const response = await this.request(next, deadline, {
        emptyRepositoryIsEmpty,
      });
      const container = envelope
        ? this.record(response.body)[envelope]
        : response.body;
      if (!Array.isArray(container)) this.invalid();
      for (const raw of container) {
        if (shouldStop(raw)) return { items: result, exhausted: false };
        result.push(normalize(raw));
      }
      next = this.nextLink(response.link);
    }
    return { items: result, exhausted: true };
  }

  private async request(
    url: string,
    deadline: number,
    options?: { emptyRepositoryIsEmpty?: boolean; ifNoneMatch?: string | null },
  ): Promise<{
    body: unknown;
    link: string | null;
    etag: string | null;
    notModified: boolean;
  }> {
    const emptyRepositoryIsEmpty = options?.emptyRepositoryIsEmpty ?? false;
    const ifNoneMatch = options?.ifNoneMatch ?? null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new CollectionAppClientError('DEADLINE');
      const signal = AbortSignal.timeout(Math.max(1, remaining));
      const token = await this.tokens.getToken(signal);
      if (deadline - this.now() <= 0)
        throw new CollectionAppClientError('DEADLINE');
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            Accept: ACCEPT,
            Authorization: `Bearer ${token}`,
            'User-Agent': USER_AGENT,
            'X-GitHub-Api-Version': API_VERSION,
            ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
          },
          signal,
        });
      } catch {
        if (this.now() >= deadline)
          throw new CollectionAppClientError('DEADLINE');
        throw new CollectionAppClientError('UPSTREAM');
      }
      if (response.status === 401) {
        if (attempt === 0) {
          this.tokens.clear(token);
          continue;
        }
        throw new CollectionAppClientError('AUTH');
      }
      if (response.status === 304) {
        return {
          body: undefined,
          link: null,
          etag: response.headers.get('etag') ?? ifNoneMatch,
          notModified: true,
        };
      }
      if (emptyRepositoryIsEmpty && response.status === 409) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new CollectionAppClientError('UPSTREAM');
        }
        if (
          typeof body === 'object' &&
          body !== null &&
          !Array.isArray(body) &&
          (body as Record<string, unknown>).message ===
            'Git Repository is empty.'
        ) {
          return {
            body: [],
            link: null,
            etag: response.headers.get('etag'),
            notModified: false,
          };
        }
      }
      if (!response.ok) {
        if (
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')))
        ) {
          throw new CollectionAppClientError(
            'RATE_LIMITED',
            this.retryAfter(response.headers),
          );
        }
        if (response.status === 403) {
          this.tokens.clear(token);
          throw new CollectionAppClientError('PERMISSION');
        }
        if (response.status === 404) {
          throw new CollectionAppClientError('NOT_FOUND');
        }
        throw new CollectionAppClientError('UPSTREAM');
      }
      try {
        return {
          body: await response.json(),
          link: response.headers.get('link'),
          etag: response.headers.get('etag'),
          notModified: false,
        };
      } catch {
        throw new CollectionAppClientError('RESPONSE');
      }
    }
    throw new CollectionAppClientError('AUTH');
  }

  /**
   * Single GraphQL POST against `config.graphqlUrl`. Mirrors
   * `CollectionDiscoveryClient.request` (`collection-discovery.client.ts`):
   * POST + bearer token, one 401 retry after clearing the token, typed
   * rate-limit/permission classification, and — critically — treating a
   * `200 OK` body carrying a non-empty top-level `errors` array as a
   * failure. GraphQL reports errors that way, so returning such a body
   * would make a real failure indistinguishable from "no commits".
   */
  private async graphql(
    payload: { query: string; variables: Record<string, unknown> },
    deadline: number = this.now() + this.config.deadlineMs,
  ): Promise<Record<string, unknown>> {
    const url = this.config.graphqlUrl ?? DEFAULT_GRAPHQL_URL;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new CollectionAppClientError('DEADLINE');
      const signal = AbortSignal.timeout(Math.max(1, remaining));
      const token = await this.tokens.getToken(signal);
      if (deadline - this.now() <= 0)
        throw new CollectionAppClientError('DEADLINE');
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          headers: {
            Accept: ACCEPT,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(payload),
          signal,
        });
      } catch {
        if (this.now() >= deadline)
          throw new CollectionAppClientError('DEADLINE');
        throw new CollectionAppClientError('UPSTREAM');
      }
      if (response.status === 401) {
        if (attempt === 0) {
          this.tokens.clear(token);
          continue;
        }
        throw new CollectionAppClientError('AUTH');
      }
      if (!response.ok) {
        if (
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')))
        ) {
          throw new CollectionAppClientError(
            'RATE_LIMITED',
            this.retryAfter(response.headers),
          );
        }
        if (response.status === 403) {
          this.tokens.clear(token);
          throw new CollectionAppClientError('PERMISSION');
        }
        throw new CollectionAppClientError('UPSTREAM');
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new CollectionAppClientError('RESPONSE');
      }
      const body = this.record(json);
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        const rateLimited = body.errors.some(
          (e) =>
            typeof e === 'object' &&
            e !== null &&
            (e as Record<string, unknown>).type === 'RATE_LIMITED',
        );
        throw new CollectionAppClientError(
          rateLimited ? 'RATE_LIMITED' : 'GRAPHQL_ERROR',
        );
      }
      return body;
    }
    throw new CollectionAppClientError('AUTH');
  }

  private nextLink(link: string | null): string | null {
    if (!link) return null;
    for (const part of link.split(',')) {
      const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part);
      if (!match || match[2] !== 'next') continue;
      const target = match[1];
      if (!target) throw new CollectionAppClientError('PAGINATION');
      let next: URL;
      try {
        next = new URL(target);
      } catch {
        throw new CollectionAppClientError('PAGINATION');
      }
      if (next.origin !== new URL(this.config.apiBaseUrl).origin)
        throw new CollectionAppClientError('PAGINATION');
      return next.toString();
    }
    return null;
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

  private repository(v: unknown): CollectionRepository {
    const r = this.record(v),
      owner = this.record(r.owner);
    return {
      id: this.id(r.id),
      name: this.string(r.name),
      fullName: this.string(r.full_name),
      private: this.boolean(r.private),
      archived: this.boolean(r.archived),
      defaultBranch: this.string(r.default_branch),
      ownerLogin: this.string(owner.login),
      htmlUrl: this.string(r.html_url),
      updatedAt: this.date(r.updated_at),
    };
  }
  private commit(v: unknown): CollectionCommit {
    const r = this.record(v),
      commit = this.record(r.commit),
      committer = this.record(commit.committer);
    return {
      sha: this.string(r.sha),
      ...this.actor(r.author),
      committedAt: this.date(committer.date),
      htmlUrl: this.string(r.html_url),
    };
  }
  /**
   * GraphQL `Commit` history node → the same `CollectionCommit` shape the
   * REST mapper produces. `author.user` is `null` for commits whose email
   * is not linked to a GitHub account; `databaseId` is stringified so the
   * stored identifier stays byte-identical to the REST path's.
   */
  private historyCommit(v: unknown): CollectionCommit {
    const r = this.record(v);
    const author = r.author;
    const user =
      author === null || author === undefined
        ? null
        : (this.record(author).user ?? null);
    return {
      sha: this.string(r.oid),
      authorLogin: user === null ? null : this.string(this.record(user).login),
      authorGithubId:
        user === null ? null : this.id(this.record(user).databaseId),
      committedAt: this.date(r.committedDate),
      htmlUrl: this.string(r.commitUrl),
    };
  }
  private pullRequest(v: unknown): CollectionPullRequest {
    const r = this.record(v),
      state = this.string(r.state);
    if (state !== 'open' && state !== 'closed') this.invalid();
    return {
      id: this.id(r.id),
      number: this.integer(r.number),
      state,
      draft: this.boolean(r.draft),
      mergedAt: this.nullableDate(r.merged_at),
      createdAt: this.date(r.created_at),
      updatedAt: this.date(r.updated_at),
      ...this.actor(r.user),
      htmlUrl: this.string(r.html_url),
    };
  }
  private release(r: Record<string, unknown>): CollectionRelease {
    return {
      id: this.id(r.id),
      tagName: this.string(r.tag_name),
      name: r.name === null ? null : this.string(r.name),
      publishedAt: this.date(r.published_at),
      ...this.actor(r.author),
      htmlUrl: this.string(r.html_url),
    };
  }
  private actor(v: unknown): {
    authorLogin: string | null;
    authorGithubId: string | null;
  } {
    if (v === null) return { authorLogin: null, authorGithubId: null };
    const actor = this.record(v);
    return {
      authorLogin: this.string(actor.login),
      authorGithubId: this.id(actor.id),
    };
  }
  private nullableDate(v: unknown): string | null {
    return v === null ? null : this.date(v);
  }
  private id(v: unknown): string {
    if (
      (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) ||
      (typeof v === 'string' && /^[1-9]\d*$/.test(v))
    )
      return String(v);
    return this.invalid();
  }
  private integer(v: unknown): number {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
    return this.invalid();
  }
  /** Non-negative counter (`totalCount`) — unlike {@link integer}, 0 is valid. */
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
  private date(v: unknown): string {
    const s = this.string(v);
    if (!Number.isFinite(Date.parse(s))) return this.invalid();
    return s;
  }
  private record(v: unknown): Record<string, unknown> {
    if (typeof v === 'object' && v !== null && !Array.isArray(v))
      return v as Record<string, unknown>;
    return this.invalid();
  }
  private segment(v: string): string {
    if (!v) throw new CollectionAppClientError('RESPONSE');
    return encodeURIComponent(v);
  }
  private invalid(): never {
    throw new CollectionAppClientError('RESPONSE');
  }
}
