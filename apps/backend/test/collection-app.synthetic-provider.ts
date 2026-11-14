import { CollectionAppClient } from '../src/github/collection-app.client';
import { CollectionAppConfigValues } from '../src/github/collection-app.config';
import { CollectionAppTokenClient } from '../src/github/collection-app-token.client';
import { type CollectionSyncRuntime } from '../src/github/collection-incremental.repository';
import { ProviderRequestQueueClient } from '../src/github/provider-request-queue.client';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const SYNTHETIC_PAGE_SIZE = 100;
const SYNTHETIC_API_BASE_URL = 'https://api.collection-scale-suite.test';
const SYNTHETIC_GRAPHQL_PATH = '/graphql';

interface SyntheticCommitSeed {
  sha: string;
  authorId: number | null;
  committedAt: string;
}

export interface SyntheticAuthoredSeed {
  id: number;
  createdAt: string;
  authorId: number | null;
}

interface SyntheticReleaseSeed {
  id: number;
  publishedAt: string;
  authorId: number | null;
}

export interface SyntheticRepositorySeed {
  id: number;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string | null;
  commits: SyntheticCommitSeed[];
  pullRequests: SyntheticAuthoredSeed[];
  issues: SyntheticAuthoredSeed[];
  releases: SyntheticReleaseSeed[];
}

type RequestKind = 'probe' | 'collect' | 'repository';

export interface SyntheticRequestCounters {
  total: number;
  byKind: Record<RequestKind, number>;
  byRepository: Map<string, Partial<Record<RequestKind, number>>>;
}

type Variables = Readonly<Record<string, unknown>>;

const newestFirst = <T>(items: readonly T[], at: (item: T) => string): T[] =>
  [...items].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));

const latest = (values: readonly string[]): string | null =>
  values.reduce<string | null>(
    (max, value) => (max === null || value > max ? value : max),
    null,
  );

export class SyntheticGithubProvider {
  private readonly repositories = new Map<string, SyntheticRepositorySeed>();
  private rateRemaining: number;
  readonly counters: SyntheticRequestCounters = {
    total: 0,
    byKind: { probe: 0, collect: 0, repository: 0 },
    byRepository: new Map(),
  };

  constructor(
    seeds: readonly SyntheticRepositorySeed[],
    options: { rateRemaining?: number } = {},
  ) {
    for (const seed of seeds) this.repositories.set(this.key(seed), seed);
    this.rateRemaining = options.rateRemaining ?? 5000;
  }

  mutate(
    owner: string,
    name: string,
    updater: (repo: SyntheticRepositorySeed) => void,
  ): void {
    const repo = this.repositories.get(`${owner}/${name}`);
    if (!repo)
      throw new Error(`unknown synthetic repository: ${owner}/${name}`);
    this.repositories.delete(`${owner}/${name}`);
    updater(repo);
    this.repositories.set(this.key(repo), repo);
  }

  remove(owner: string, name: string): void {
    this.repositories.delete(`${owner}/${name}`);
  }

  resetCounters(): void {
    this.counters.total = 0;
    this.counters.byKind = { probe: 0, collect: 0, repository: 0 };
    this.counters.byRepository.clear();
  }

  readonly fetcher: Fetcher = (input, init) => {
    const url = new URL(input.toString());
    if (url.pathname === SYNTHETIC_GRAPHQL_PATH) {
      if (typeof init?.body !== 'string') {
        throw new Error('synthetic GraphQL request needs a JSON body');
      }
      return Promise.resolve(this.graphql(init.body));
    }
    const match = /^\/repositories\/(\d+)$/.exec(url.pathname);
    if (match) return Promise.resolve(this.repositoryById(Number(match[1])));
    throw new Error(`unexpected synthetic request: ${url.pathname}`);
  };

  private key(repo: SyntheticRepositorySeed): string {
    return `${repo.owner}/${repo.name}`;
  }

  private record(kind: RequestKind, repoKey?: string): void {
    this.counters.total += 1;
    this.counters.byKind[kind] += 1;
    if (repoKey) {
      const existing = this.counters.byRepository.get(repoKey) ?? {};
      existing[kind] = (existing[kind] ?? 0) + 1;
      this.counters.byRepository.set(repoKey, existing);
    }
  }

  private json(body: unknown, status = 200): Response {
    this.rateRemaining = Math.max(0, this.rateRemaining - 1);
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'x-ratelimit-remaining': String(this.rateRemaining),
        'x-ratelimit-limit': '5000',
      },
    });
  }

  private rateLimit(): { cost: number; remaining: number } {
    return { cost: 1, remaining: this.rateRemaining };
  }

  private repositoryById(id: number): Response {
    const repo = [...this.repositories.values()].find((item) => item.id === id);
    this.record('repository', repo ? this.key(repo) : undefined);
    if (!repo) return this.json({ message: 'Not Found' }, 404);
    return this.json({
      id: repo.id,
      full_name: this.key(repo),
      private: repo.private,
      archived: false,
      default_branch: repo.defaultBranch,
    });
  }

  private graphql(body: string): Response {
    const { query, variables } = JSON.parse(body) as {
      readonly query: string;
      readonly variables: Variables;
    };
    if (query.includes('query CollectionProbe(')) return this.probe(variables);
    if (query.includes('query CollectionRepositoryContributions(')) {
      return this.collect(variables);
    }
    throw new Error('unknown synthetic GraphQL query');
  }

  private probe(variables: Variables): Response {
    this.record('probe');
    const data: Record<string, unknown> = { rateLimit: this.rateLimit() };
    const errors: unknown[] = [];
    for (let index = 0; `o${index}` in variables; index += 1) {
      const alias = `r${index}`;
      const repo = this.repositories.get(
        `${String(variables[`o${index}`])}/${String(variables[`n${index}`])}`,
      );
      if (!repo) {
        data[alias] = null;
        errors.push({ type: 'NOT_FOUND', path: [alias] });
        continue;
      }
      const release = newestFirst(repo.releases, (item) => item.publishedAt)[0];
      data[alias] = {
        databaseId: repo.id,
        nameWithOwner: this.key(repo),
        isArchived: false,
        isPrivate: repo.private,
        defaultBranchRef:
          repo.defaultBranch === null ? null : { name: repo.defaultBranch },
        pushedAt: latest(repo.commits.map((commit) => commit.committedAt)),
        issues: this.latestUpdated(repo.issues),
        pullRequests: this.latestUpdated(repo.pullRequests),
        releases: {
          nodes: release
            ? [
                {
                  createdAt: release.publishedAt,
                  publishedAt: release.publishedAt,
                },
              ]
            : [],
        },
      };
    }
    return this.json(errors.length > 0 ? { data, errors } : { data });
  }

  private latestUpdated(items: readonly SyntheticAuthoredSeed[]): unknown {
    const updatedAt = latest(items.map((item) => item.createdAt));
    return { nodes: updatedAt === null ? [] : [{ updatedAt }] };
  }

  private collect(variables: Variables): Response {
    const key = `${String(variables.owner)}/${String(variables.name)}`;
    this.record('collect', key);
    const repo = this.repositories.get(key);
    if (!repo) {
      return this.json({
        data: { rateLimit: this.rateLimit(), repository: null },
        errors: [{ type: 'NOT_FOUND', path: ['repository'] }],
      });
    }
    const since = typeof variables.since === 'string' ? variables.since : null;
    const repository: Record<string, unknown> = {};
    if (variables.withCommits === true) {
      const commits = newestFirst(
        repo.commits.filter(
          (commit) => since === null || commit.committedAt >= since,
        ),
        (commit) => commit.committedAt,
      );
      repository.ref = {
        target: {
          history: this.page(commits, variables.commitCursor, (commit) => ({
            oid: commit.sha,
            committedDate: commit.committedAt,
            author: {
              user:
                commit.authorId === null
                  ? null
                  : { databaseId: commit.authorId },
            },
          })),
        },
      };
    }
    const authored = (item: SyntheticAuthoredSeed) => ({
      fullDatabaseId: String(item.id),
      createdAt: item.createdAt,
      author: item.authorId === null ? null : { databaseId: item.authorId },
    });
    if (variables.withPullRequests === true) {
      repository.pullRequests = this.page(
        newestFirst(repo.pullRequests, (item) => item.createdAt),
        variables.pullRequestCursor,
        authored,
      );
    }
    if (variables.withIssues === true) {
      repository.issues = this.page(
        newestFirst(
          repo.issues.filter(
            (item) => since === null || item.createdAt >= since,
          ),
          (item) => item.createdAt,
        ),
        variables.issueCursor,
        authored,
      );
    }
    if (variables.withReleases === true) {
      repository.releases = this.page(
        newestFirst(repo.releases, (item) => item.publishedAt),
        variables.releaseCursor,
        (release) => ({
          databaseId: release.id,
          createdAt: release.publishedAt,
          publishedAt: release.publishedAt,
          isDraft: false,
          author:
            release.authorId === null ? null : { databaseId: release.authorId },
        }),
      );
    }
    return this.json({ data: { rateLimit: this.rateLimit(), repository } });
  }

  private page<T>(
    items: readonly T[],
    cursor: unknown,
    toNode: (item: T) => unknown,
  ): unknown {
    const start = typeof cursor === 'string' ? Number(cursor) : 0;
    const end = start + SYNTHETIC_PAGE_SIZE;
    return {
      nodes: items.slice(start, end).map(toNode),
      pageInfo: { hasNextPage: end < items.length, endCursor: String(end) },
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
  maxPages: 100,
  deadlineMs: 30_000,
};

export function createSyntheticSyncRuntime(
  provider: SyntheticGithubProvider,
  queue: ProviderRequestQueueClient,
): CollectionSyncRuntime {
  const tokens = {
    getToken: () => Promise.resolve('synthetic-token'),
    clear: () => undefined,
  } as unknown as CollectionAppTokenClient;
  const client = new CollectionAppClient(
    syntheticAppConfig,
    tokens,
    queue.wrapFetcher((input, init) => provider.fetcher(input, init)),
  );
  return {
    appId: syntheticAppConfig.appId,
    organizationLogin: syntheticAppConfig.orgLogin,
    tokens,
    client,
    queue,
  };
}
