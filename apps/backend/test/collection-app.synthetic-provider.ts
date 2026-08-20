import {
  CollectionAppClient,
  type CollectionCommit,
  type CollectionPullRequest,
  type CollectionRelease,
  type CollectionRepository,
} from '../src/github/collection-app.client';
import { CollectionAppConfigValues } from '../src/github/collection-app.config';
import { CollectionAppTokenProvider } from '../src/github/collection-app.token';
import { ProviderRequestQueue } from '../src/github/collection-provider-queue';
import type { CollectionSyncRuntime } from '../src/github/service/collection-sync.service';

/**
 * Fetcher-level synthetic GitHub REST provider for the public-admin-exposure
 * todo 13 100-repository scale/idempotency integration suite. Unlike a
 * client-level double (which stubs `CollectionAppClient`'s
 * methods directly), this fixture answers at the `Fetcher` boundary
 * (`(input, init) => Promise<Response>`) so the *real* `CollectionAppClient`
 * pagination, conditional-GET (ETag/304), and Link-header traversal all run
 * against synthetic data — no live GitHub call is ever made.
 */

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Small page size so a handful of synthetic items already exercise real multi-page traversal. */
export const SYNTHETIC_PAGE_SIZE = 4;

export const SYNTHETIC_API_BASE_URL = 'https://api.collection-scale-suite.test';

export interface SyntheticCommitSeed {
  sha: string;
  authorId: number | null;
  authorLogin: string | null;
  committedAt: string;
}

export interface SyntheticPullRequestSeed {
  id: number;
  createdAt: string;
  state: 'open' | 'closed';
  authorId: number | null;
  authorLogin: string | null;
}

export interface SyntheticReleaseSeed {
  id: number;
  publishedAt: string;
  authorId: number | null;
  authorLogin: string | null;
}

export interface SyntheticRepositorySeed {
  /** synthetic githubRepositoryId — kept well under Number.MAX_SAFE_INTEGER. */
  id: number;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  /** newest-first, matching GitHub's default branch commit order. */
  commits: SyntheticCommitSeed[];
  pullRequests: SyntheticPullRequestSeed[];
  releases: SyntheticReleaseSeed[];
  /** never emit an ETag for this repo's probes — forces a full re-check every run. */
  noEtag?: boolean;
}

type RequestKind =
  | 'installation'
  | 'commit-probe'
  | 'commit-list'
  | 'pull-list'
  | 'release-probe'
  | 'release-list';

export interface SyntheticRequestCounters {
  total: number;
  byKind: Record<RequestKind, number>;
  byRepositoryKind: Map<string, Partial<Record<RequestKind, number>>>;
}

const emptyByKind = (): Record<RequestKind, number> => ({
  installation: 0,
  'commit-probe': 0,
  'commit-list': 0,
  'pull-list': 0,
  'release-probe': 0,
  'release-list': 0,
});

/** Deterministic pages-required count for `n` items at `SYNTHETIC_PAGE_SIZE` — a full listing always issues at least one request even for zero items. */
export const syntheticPageCount = (itemCount: number): number =>
  Math.max(1, Math.ceil(itemCount / SYNTHETIC_PAGE_SIZE));

export class SyntheticGithubProvider {
  private readonly repositories = new Map<string, SyntheticRepositorySeed>();
  private readonly installationOrder: SyntheticRepositorySeed[];
  private rateRemaining: number;
  private readonly rateLimit: number;
  readonly counters: SyntheticRequestCounters = {
    total: 0,
    byKind: emptyByKind(),
    byRepositoryKind: new Map(),
  };

  constructor(
    seeds: readonly SyntheticRepositorySeed[],
    options: { rateRemaining?: number; rateLimit?: number } = {},
  ) {
    for (const seed of seeds) {
      this.repositories.set(`${seed.owner}/${seed.name}`, seed);
    }
    // Deliberately serve installation listing in reverse of seed/id order so
    // fair-cursor-order assertions exercise the service's own sort rather
    // than an incidentally-already-sorted provider response.
    this.installationOrder = [...this.repositories.values()].reverse();
    this.rateLimit = options.rateLimit ?? 5000;
    this.rateRemaining = options.rateRemaining ?? this.rateLimit;
  }

  setRateRemaining(value: number): void {
    this.rateRemaining = value;
  }

  mutate(
    owner: string,
    name: string,
    updater: (repo: SyntheticRepositorySeed) => void,
  ): void {
    const repo = this.repositoryFor(owner, name);
    updater(repo);
  }

  readonly fetcher: Fetcher = (input, init) => {
    const url = new URL(input.toString());
    const ifNoneMatch = new Headers(init?.headers).get('if-none-match');
    return Promise.resolve(this.handle(url, ifNoneMatch));
  };

  private repositoryFor(owner: string, name: string): SyntheticRepositorySeed {
    const repo = this.repositories.get(`${owner}/${name}`);
    if (!repo) {
      throw new Error(`unknown synthetic repository: ${owner}/${name}`);
    }
    return repo;
  }

  private record(kind: RequestKind, repoKey?: string): void {
    this.counters.total += 1;
    this.counters.byKind[kind] += 1;
    if (repoKey) {
      const existing = this.counters.byRepositoryKind.get(repoKey) ?? {};
      existing[kind] = (existing[kind] ?? 0) + 1;
      this.counters.byRepositoryKind.set(repoKey, existing);
    }
  }

  private rateHeaders(): Record<string, string> {
    this.rateRemaining = Math.max(0, this.rateRemaining - 1);
    return {
      'x-ratelimit-remaining': String(this.rateRemaining),
      'x-ratelimit-limit': String(this.rateLimit),
    };
  }

  private json(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...headers, ...this.rateHeaders() },
    });
  }

  private notModified(etag: string): Response {
    return new Response(null, {
      status: 304,
      headers: { etag, ...this.rateHeaders() },
    });
  }

  private handle(url: URL, ifNoneMatch: string | null): Response {
    if (url.pathname === '/installation/repositories') {
      this.record('installation');
      const repositories = this.installationOrder.map((repo) =>
        this.repositoryJson(repo),
      );
      return this.json({
        total_count: repositories.length,
        repositories,
      });
    }

    const commitsMatch = /^\/repos\/([^/]+)\/([^/]+)\/commits$/.exec(
      url.pathname,
    );
    if (commitsMatch) {
      const [, owner, name] = commitsMatch as unknown as [
        string,
        string,
        string,
      ];
      const repo = this.repositoryFor(owner, name);
      const repoKey = `${owner}/${name}`;
      const perPage = Number(url.searchParams.get('per_page'));
      if (perPage === 1) {
        this.record('commit-probe', repoKey);
        const etag = this.commitEtag(repo);
        if (!repo.noEtag && ifNoneMatch !== null && ifNoneMatch === etag) {
          return this.notModified(etag);
        }
        const head = repo.commits[0];
        const body = head ? [this.commitJson(head)] : [];
        return this.json(body, repo.noEtag ? {} : { etag });
      }
      this.record('commit-list', repoKey);
      return this.paginated(url, repo.commits, (commit) =>
        this.commitJson(commit),
      );
    }

    const pullsMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(url.pathname);
    if (pullsMatch) {
      const [, owner, name] = pullsMatch as unknown as [string, string, string];
      const repo = this.repositoryFor(owner, name);
      const repoKey = `${owner}/${name}`;
      this.record('pull-list', repoKey);
      const sorted = [...repo.pullRequests].sort((a, b) =>
        a.createdAt === b.createdAt
          ? b.id - a.id
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      );
      return this.paginated(url, sorted, (pr) => this.pullRequestJson(pr));
    }

    const releasesMatch = /^\/repos\/([^/]+)\/([^/]+)\/releases$/.exec(
      url.pathname,
    );
    if (releasesMatch) {
      const [, owner, name] = releasesMatch as unknown as [
        string,
        string,
        string,
      ];
      const repo = this.repositoryFor(owner, name);
      const repoKey = `${owner}/${name}`;
      const sorted = [...repo.releases].sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id - a.id
          : a.publishedAt < b.publishedAt
            ? 1
            : -1,
      );
      const perPage = Number(url.searchParams.get('per_page'));
      if (perPage === 1) {
        this.record('release-probe', repoKey);
        const etag = this.releaseEtag(repo, sorted);
        if (!repo.noEtag && ifNoneMatch !== null && ifNoneMatch === etag) {
          return this.notModified(etag);
        }
        const head = sorted[0];
        const body = head ? [this.releaseJson(head)] : [];
        return this.json(body, repo.noEtag ? {} : { etag });
      }
      this.record('release-list', repoKey);
      return this.paginated(url, sorted, (release) =>
        this.releaseJson(release),
      );
    }

    throw new Error(
      `unexpected synthetic collection-app request: ${url.pathname}${url.search}`,
    );
  }

  private paginated<T>(
    url: URL,
    items: readonly T[],
    toJson: (item: T) => unknown,
  ): Response {
    const page = Number(url.searchParams.get('page') ?? '1');
    const start = (page - 1) * SYNTHETIC_PAGE_SIZE;
    const slice = items.slice(start, start + SYNTHETIC_PAGE_SIZE);
    const body = slice.map(toJson);
    const headers: Record<string, string> = {};
    if (start + SYNTHETIC_PAGE_SIZE < items.length) {
      const next = new URL(url.toString());
      next.searchParams.set('page', String(page + 1));
      headers.link = `<${next.toString()}>; rel="next"`;
    }
    return this.json(body, headers);
  }

  private commitEtag(repo: SyntheticRepositorySeed): string {
    const head = repo.commits[0];
    return `"commit:${repo.id}:${head ? head.sha : 'empty'}"`;
  }

  private releaseEtag(
    repo: SyntheticRepositorySeed,
    sorted: readonly SyntheticReleaseSeed[],
  ): string {
    const head = sorted[0];
    return `"release:${repo.id}:${head ? `${head.id}:${head.publishedAt}` : 'empty'}"`;
  }

  private repositoryJson(repo: SyntheticRepositorySeed): unknown {
    return {
      id: repo.id,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      private: repo.private,
      archived: false,
      default_branch: repo.defaultBranch,
      owner: { login: repo.owner },
      html_url: `https://example.invalid/${repo.owner}/${repo.name}`,
      updated_at: '2026-08-01T00:00:00.000Z',
    };
  }

  private commitJson(commit: SyntheticCommitSeed): unknown {
    return {
      sha: commit.sha,
      author:
        commit.authorId === null
          ? null
          : { id: commit.authorId, login: commit.authorLogin },
      commit: { committer: { date: commit.committedAt } },
      html_url: `https://example.invalid/commit/${commit.sha}`,
    };
  }

  private pullRequestJson(pr: SyntheticPullRequestSeed): unknown {
    return {
      id: pr.id,
      number: pr.id,
      state: pr.state,
      draft: false,
      merged_at: null,
      created_at: pr.createdAt,
      updated_at: pr.createdAt,
      user:
        pr.authorId === null
          ? null
          : { id: pr.authorId, login: pr.authorLogin },
      html_url: `https://example.invalid/pull/${pr.id}`,
    };
  }

  private releaseJson(release: SyntheticReleaseSeed): unknown {
    return {
      id: release.id,
      tag_name: `v${release.id}`,
      name: null,
      draft: false,
      prerelease: false,
      published_at: release.publishedAt,
      author:
        release.authorId === null
          ? null
          : { id: release.authorId, login: release.authorLogin },
      html_url: `https://example.invalid/release/${release.id}`,
    };
  }
}

/** Exposed so callers can key lease/cursor rows to the exact same identity
 * the runtime's `CollectionAppClient` actually uses — avoids a drifted
 * duplicate constant going out of sync with `syntheticAppConfig` below. */
export const SYNTHETIC_APP_ID = '9000000000002001';
export const SYNTHETIC_ORG_LOGIN = 'synthetic-scale-org';

const syntheticAppConfig: CollectionAppConfigValues = {
  appId: SYNTHETIC_APP_ID,
  orgLogin: SYNTHETIC_ORG_LOGIN,
  privateKey: 'unused',
  apiBaseUrl: SYNTHETIC_API_BASE_URL,
  maxPages: 50,
  deadlineMs: 30_000,
};

function createSyntheticTokenProvider(): CollectionAppTokenProvider {
  return {
    getToken: () => Promise.resolve('synthetic-token'),
    clear: () => undefined,
  } as unknown as CollectionAppTokenProvider;
}

/**
 * Builds a real `CollectionSyncRuntime` whose `client` is backed by the
 * synthetic provider's fetcher, wrapped through a real `ProviderRequestQueue`
 * (pacing + rate-limit-aware dynamic stop) — no method of `CollectionAppClient`
 * or `ProviderRequestQueue` is stubbed. `fetcherMiddleware` lets a caller
 * observe dispatch order/timing (e.g. to assert serial pacing) without
 * altering behavior.
 */
export function createSyntheticSyncRuntime(
  provider: SyntheticGithubProvider,
  queue: ProviderRequestQueue,
  fetcherMiddleware: Fetcher = (input, init) => provider.fetcher(input, init),
): CollectionSyncRuntime {
  const tokens = createSyntheticTokenProvider();
  const client = new CollectionAppClient(
    syntheticAppConfig,
    tokens,
    queue.wrapFetcher(fetcherMiddleware),
  );
  return {
    appId: syntheticAppConfig.appId,
    organizationLogin: syntheticAppConfig.orgLogin,
    tokens,
    client,
    queue,
  };
}

export type {
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
  CollectionRepository,
};
