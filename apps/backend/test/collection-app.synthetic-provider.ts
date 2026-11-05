import { CollectionAppClient } from '../src/github/collection-app.client';
import { CollectionAppConfigValues } from '../src/github/collection-app.config';
import { CollectionAppTokenClient } from '../src/github/collection-app-token.client';
import { type CollectionSyncRuntime } from '../src/github/collection-incremental.repository';
import { ProviderRequestQueueClient } from '../src/github/provider-request-queue.client';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const SYNTHETIC_PAGE_SIZE = 4;

const SYNTHETIC_API_BASE_URL = 'https://api.collection-scale-suite.test';
const SYNTHETIC_GRAPHQL_PATH = '/graphql';

const syntheticUserNodeId = (login: string): string => `node:${login}`;

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

export interface SyntheticIssueSeed {
  id: number;
  createdAt: string;
  state: 'open' | 'closed';
  authorId: number | null;
  authorLogin: string | null;
}

export interface SyntheticRepositorySeed {
  id: number;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;

  commits: SyntheticCommitSeed[];
  pullRequests: SyntheticPullRequestSeed[];
  releases: SyntheticReleaseSeed[];

  issues?: SyntheticIssueSeed[];

  noEtag?: boolean;
}

type RequestKind =
  | 'installation'
  | 'repository'
  | 'user-node'
  | 'commit-history'
  | 'commit-count'
  | 'commit-probe'
  | 'commit-list'
  | 'pull-list'
  | 'issue-list'
  | 'release-probe'
  | 'release-list';

export interface SyntheticRequestCounters {
  total: number;
  byKind: Record<RequestKind, number>;
  byRepositoryKind: Map<string, Partial<Record<RequestKind, number>>>;
}

const emptyByKind = (): Record<RequestKind, number> => ({
  installation: 0,
  repository: 0,
  'user-node': 0,
  'commit-history': 0,
  'commit-count': 0,
  'commit-probe': 0,
  'commit-list': 0,
  'pull-list': 0,
  'issue-list': 0,
  'release-probe': 0,
  'release-list': 0,
});

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
    if (url.pathname === SYNTHETIC_GRAPHQL_PATH) {
      if (typeof init?.body !== 'string') {
        throw new Error('synthetic GraphQL request needs a JSON body');
      }
      return Promise.resolve(this.handleGraphql(init.body));
    }
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

  private handleGraphql(body: string): Response {
    const { query, variables } = JSON.parse(body) as {
      readonly query: string;
      readonly variables: Readonly<Record<string, string | null>>;
    };
    if (query.includes('CollectionUserNodeId')) {
      this.record('user-node');
      return this.json({
        data: { user: { id: syntheticUserNodeId(String(variables.login)) } },
      });
    }
    const owner = String(variables.owner);
    const name = String(variables.name);
    const repo = this.repositoryFor(owner, name);
    const repoKey = `${owner}/${name}`;
    if (query.includes('CollectionAuthorCommits')) {
      this.record('commit-history', repoKey);
      const authored = repo.commits.filter(
        (commit) =>
          commit.authorLogin !== null &&
          syntheticUserNodeId(commit.authorLogin) === variables.authorId,
      );
      const start = Number(variables.cursor ?? '0');
      const end = start + SYNTHETIC_PAGE_SIZE;
      return this.json({
        data: {
          repository: {
            ref: {
              target: {
                history: {
                  nodes: authored
                    .slice(start, end)
                    .map((commit) => this.commitHistoryNode(commit)),
                  pageInfo: {
                    hasNextPage: end < authored.length,
                    endCursor: String(end),
                  },
                },
              },
            },
          },
        },
      });
    }
    if (query.includes('CollectionDefaultBranchCommitCount')) {
      this.record('commit-count', repoKey);
      const since = Date.parse(String(variables.since));
      const until = Date.parse(String(variables.until));
      const inWindow = repo.commits.filter((commit) => {
        const committedAt = Date.parse(commit.committedAt);
        return committedAt >= since && committedAt <= until;
      });
      return this.json({
        data: {
          repository: {
            ref: {
              target: {
                history: {
                  totalCount: new Set(inWindow.map((commit) => commit.sha))
                    .size,
                },
              },
            },
          },
        },
      });
    }
    throw new Error(`unknown synthetic GraphQL query: ${query}`);
  }

  private handle(url: URL, ifNoneMatch: string | null): Response {
    const repositoryMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    const owner = repositoryMatch?.[1];
    const name = repositoryMatch?.[2];
    if (owner !== undefined && name !== undefined) {
      this.record('repository', `${owner}/${name}`);
      return this.json(this.repositoryJson(this.repositoryFor(owner, name)));
    }
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

    const issuesMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(
      url.pathname,
    );
    if (issuesMatch) {
      const [, owner, name] = issuesMatch as unknown as [
        string,
        string,
        string,
      ];
      const repo = this.repositoryFor(owner, name);
      this.record('issue-list', `${owner}/${name}`);
      const listing = [
        ...(repo.issues ?? []).map((issue) => ({
          ...issue,
          pullRequest: false,
        })),
        ...repo.pullRequests.map((pr) => ({ ...pr, pullRequest: true })),
      ].sort((a, b) =>
        a.createdAt === b.createdAt
          ? b.id - a.id
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      );
      return this.paginated(url, listing, (item) => this.issueJson(item));
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

  private commitHistoryNode(commit: SyntheticCommitSeed): unknown {
    return {
      oid: commit.sha,
      committedDate: commit.committedAt,
      commitUrl: `https://example.invalid/commit/${commit.sha}`,
      author: {
        user:
          commit.authorId === null
            ? null
            : { databaseId: commit.authorId, login: commit.authorLogin },
      },
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

  private issueJson(
    item: SyntheticIssueSeed & { pullRequest: boolean },
  ): unknown {
    return {
      id: item.id,
      number: item.id,
      state: item.state,
      created_at: item.createdAt,
      user:
        item.authorId === null
          ? null
          : { id: item.authorId, login: item.authorLogin },
      ...(item.pullRequest
        ? { pull_request: { url: `https://example.invalid/pull/${item.id}` } }
        : {}),
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

export const SYNTHETIC_APP_ID = '9000000000002001';
export const SYNTHETIC_ORG_LOGIN = 'synthetic-scale-org';

const syntheticAppConfig: CollectionAppConfigValues = {
  appId: SYNTHETIC_APP_ID,
  orgLogin: SYNTHETIC_ORG_LOGIN,
  privateKey: 'unused',
  apiBaseUrl: SYNTHETIC_API_BASE_URL,
  graphqlUrl: `${SYNTHETIC_API_BASE_URL}${SYNTHETIC_GRAPHQL_PATH}`,
  maxPages: 50,
  deadlineMs: 30_000,
};

function createSyntheticTokenProvider(): CollectionAppTokenClient {
  return {
    getToken: () => Promise.resolve('synthetic-token'),
    clear: () => undefined,
  } as unknown as CollectionAppTokenClient;
}

export function createSyntheticSyncRuntime(
  provider: SyntheticGithubProvider,
  queue: ProviderRequestQueueClient,
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
