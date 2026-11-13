import { Injectable } from '@nestjs/common';
import { CollectionAppConfigValues } from './collection-app.config';
import { CollectionAppClientError } from './collection-app.error';

const ACCEPT = 'application/vnd.github+json';
const API_VERSION = '2022-11-28';

const DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql';
const USER_AGENT = 'oss-hub-collection-app';

const PROBE_FIELDS = `
  fragment CollectionProbeFields on Repository {
    databaseId
    nameWithOwner
    isArchived
    isPrivate
    defaultBranchRef { name }
    pushedAt
    issues(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { updatedAt } }
    pullRequests(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { updatedAt } }
    releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { createdAt publishedAt } }
  }
`;

const REPOSITORY_CONTRIBUTIONS_QUERY = `
  query CollectionRepositoryContributions(
    $owner: String!
    $name: String!
    $branch: String!
    $since: GitTimestamp
    $issueSince: DateTime
    $withCommits: Boolean!
    $withPullRequests: Boolean!
    $withIssues: Boolean!
    $withReleases: Boolean!
    $commitCursor: String
    $pullRequestCursor: String
    $issueCursor: String
    $releaseCursor: String
  ) {
    rateLimit { cost remaining }
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $branch) @include(if: $withCommits) {
        target {
          ... on Commit {
            history(first: 100, since: $since, after: $commitCursor) {
              nodes { oid committedDate author { user { databaseId } } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
      pullRequests(
        first: 100
        after: $pullRequestCursor
        orderBy: { field: CREATED_AT, direction: DESC }
      ) @include(if: $withPullRequests) {
        nodes { fullDatabaseId createdAt author { ... on User { databaseId } ... on Bot { databaseId } } }
        pageInfo { hasNextPage endCursor }
      }
      issues(
        first: 100
        after: $issueCursor
        filterBy: { since: $issueSince }
        orderBy: { field: CREATED_AT, direction: DESC }
      ) @include(if: $withIssues) {
        nodes { fullDatabaseId createdAt author { ... on User { databaseId } ... on Bot { databaseId } } }
        pageInfo { hasNextPage endCursor }
      }
      releases(
        first: 100
        after: $releaseCursor
        orderBy: { field: CREATED_AT, direction: DESC }
      ) @include(if: $withReleases) {
        nodes { databaseId createdAt publishedAt isDraft author { databaseId } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CollectionAppClientTokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
  clear(expectedToken?: string): void;
}

export interface CollectionRepository {
  id: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
}

export interface CollectionRateLimit {
  readonly cost: number;
  readonly remaining: number;
}

export interface CollectionProbeTarget {
  readonly owner: string;
  readonly name: string;
}

export interface CollectionRepositoryProbe {
  readonly githubRepositoryId: string;
  readonly nameWithOwner: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly private: boolean;
  readonly activityAt: readonly Date[];
}

export interface CollectionProbeResult {
  readonly repositories: readonly (CollectionRepositoryProbe | null)[];
  readonly rateLimit: CollectionRateLimit | null;
}

export type CollectionContributionKind =
  'commit' | 'pull_request' | 'issue' | 'release';

export interface CollectionContribution {
  readonly githubKey: string;
  readonly authorGithubId: string | null;
  readonly occurredAt: Date;
}

export interface CollectionRepositoryContributions {
  readonly contributions: Readonly<
    Record<CollectionContributionKind, readonly CollectionContribution[]>
  >;
  readonly requests: number;
  readonly pointsUsed: number;
  readonly rateLimit: CollectionRateLimit | null;
}

const CONTRIBUTION_KINDS: readonly CollectionContributionKind[] = [
  'commit',
  'pull_request',
  'issue',
  'release',
];

const CONNECTION_VARIABLES: Readonly<
  Record<CollectionContributionKind, { include: string; cursor: string }>
> = {
  commit: { include: 'withCommits', cursor: 'commitCursor' },
  pull_request: { include: 'withPullRequests', cursor: 'pullRequestCursor' },
  issue: { include: 'withIssues', cursor: 'issueCursor' },
  release: { include: 'withReleases', cursor: 'releaseCursor' },
};

interface ConnectionPage {
  readonly contributions: readonly CollectionContribution[];
  readonly nextCursor: string | null;
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

@Injectable()
export class CollectionAppClient {
  constructor(
    private readonly config: CollectionAppConfigValues,
    private readonly tokens: CollectionAppClientTokenProvider,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getRepositoryById(
    githubRepositoryId: bigint,
  ): Promise<CollectionRepository> {
    return this.repository(
      await this.one(`/repositories/${githubRepositoryId.toString()}`),
    );
  }

  async probeRepositories(
    targets: readonly CollectionProbeTarget[],
  ): Promise<CollectionProbeResult> {
    if (targets.length === 0) return { repositories: [], rateLimit: null };
    const variables: Record<string, string> = {};
    const declarations: string[] = [];
    const selections: string[] = [];
    targets.forEach((target, index) => {
      variables[`o${index}`] = target.owner;
      variables[`n${index}`] = target.name;
      declarations.push(`$o${index}: String!, $n${index}: String!`);
      selections.push(
        `r${index}: repository(owner: $o${index}, name: $n${index}) { ...CollectionProbeFields }`,
      );
    });
    const query = `query CollectionProbe(${declarations.join(', ')}) {
      rateLimit { cost remaining }
      ${selections.join('\n')}
    }
    ${PROBE_FIELDS}`;
    const body = await this.graphql(
      { query, variables },
      this.now() + this.config.deadlineMs,
      true,
    );
    const data = this.record(body.data);
    const erroredAliases = new Set(
      (Array.isArray(body.errors) ? body.errors : []).map(
        (error) => (this.record(error).path as unknown[])[0],
      ),
    );
    return {
      repositories: targets.map((_, index) => {
        const alias = `r${index}`;
        const repository = data[alias];
        if (erroredAliases.has(alias)) return null;
        if (repository === null || repository === undefined) return null;
        return this.probedRepository(repository);
      }),
      rateLimit: this.rateLimit(data.rateLimit),
    };
  }

  async collectRepositoryContributions(
    owner: string,
    name: string,
    defaultBranch: string | null,
    since: Date | null,
  ): Promise<CollectionRepositoryContributions> {
    const pending = CONTRIBUTION_KINDS.filter(
      (kind) => kind !== 'commit' || defaultBranch !== null,
    );
    const collected: Record<
      CollectionContributionKind,
      CollectionContribution[]
    > = { commit: [], pull_request: [], issue: [], release: [] };
    let requests = 0;
    let pointsUsed = 0;
    let rateLimit: CollectionRateLimit | null = null;

    const read = async (
      kinds: readonly CollectionContributionKind[],
      cursor: string | null,
      deadline: number,
    ): Promise<Map<CollectionContributionKind, ConnectionPage>> => {
      const variables: Record<string, unknown> = {
        owner,
        name,
        branch: defaultBranch ?? '',
        since: since?.toISOString() ?? null,
        issueSince: since?.toISOString() ?? null,
      };
      for (const kind of CONTRIBUTION_KINDS) {
        variables[CONNECTION_VARIABLES[kind].include] = kinds.includes(kind);
        variables[CONNECTION_VARIABLES[kind].cursor] =
          kinds.length === 1 && kinds[0] === kind ? cursor : null;
      }
      const body = await this.graphql(
        { query: REPOSITORY_CONTRIBUTIONS_QUERY, variables },
        deadline,
      );
      requests += 1;
      const data = this.record(body.data);
      const limit = this.rateLimit(data.rateLimit);
      if (limit !== null) {
        pointsUsed += limit.cost;
        rateLimit = limit;
      }
      const repository = this.record(data.repository);
      return new Map(
        kinds.map((kind) => [
          kind,
          this.connectionPage(kind, repository, since),
        ]),
      );
    };

    const first = await read(
      pending,
      null,
      this.now() + this.config.deadlineMs,
    );
    for (const kind of pending) {
      let page = first.get(kind);
      for (let pageIndex = 1; page !== undefined; pageIndex += 1) {
        collected[kind].push(...page.contributions);
        if (page.nextCursor === null) break;
        if (pageIndex >= this.config.maxPages)
          throw new CollectionAppClientError('PAGINATION');
        page = (
          await read(
            [kind],
            page.nextCursor,
            this.now() + this.config.deadlineMs,
          )
        ).get(kind);
      }
    }

    return {
      contributions: {
        commit: dedupeByKey(collected.commit, (item) => item.githubKey),
        pull_request: dedupeByKey(
          collected.pull_request,
          (item) => item.githubKey,
        ),
        issue: dedupeByKey(collected.issue, (item) => item.githubKey),
        release: dedupeByKey(collected.release, (item) => item.githubKey),
      },
      requests,
      pointsUsed,
      rateLimit,
    };
  }

  private connectionPage(
    kind: CollectionContributionKind,
    repository: Record<string, unknown>,
    since: Date | null,
  ): ConnectionPage {
    if (kind === 'commit') {
      const ref = repository.ref;
      if (ref === null || ref === undefined) {
        return { contributions: [], nextCursor: null };
      }
      const target = this.record(ref).target;
      if (target === null || target === undefined) {
        return { contributions: [], nextCursor: null };
      }
      const history = this.record(this.record(target).history);
      return {
        contributions: this.nodes(history).map((node) => this.commit(node)),
        nextCursor: this.nextCursor(history),
      };
    }
    const connection = this.record(
      repository[
        kind === 'pull_request'
          ? 'pullRequests'
          : kind === 'issue'
            ? 'issues'
            : 'releases'
      ],
    );
    const contributions: CollectionContribution[] = [];
    for (const node of this.nodes(connection)) {
      const record = this.record(node);
      if (since !== null && new Date(this.date(record.createdAt)) < since) {
        return { contributions, nextCursor: null };
      }
      const contribution =
        kind === 'release' ? this.release(record) : this.authored(record);
      if (contribution !== null) contributions.push(contribution);
    }
    return { contributions, nextCursor: this.nextCursor(connection) };
  }

  private probedRepository(value: unknown): CollectionRepositoryProbe {
    const r = this.record(value);
    const defaultBranchRef = r.defaultBranchRef;
    const activityAt: Date[] = [];
    if (r.pushedAt !== null) activityAt.push(new Date(this.date(r.pushedAt)));
    for (const [connection, field] of [
      ['issues', 'updatedAt'],
      ['pullRequests', 'updatedAt'],
      ['releases', 'createdAt'],
      ['releases', 'publishedAt'],
    ] as const) {
      const latest = this.nodes(this.record(r[connection]))[0];
      if (latest === undefined) continue;
      const at = this.record(latest)[field];
      if (at !== null) activityAt.push(new Date(this.date(at)));
    }
    return {
      githubRepositoryId: this.id(r.databaseId),
      nameWithOwner: this.string(r.nameWithOwner),
      defaultBranch:
        defaultBranchRef === null
          ? null
          : this.string(this.record(defaultBranchRef).name),
      archived: this.boolean(r.isArchived),
      private: this.boolean(r.isPrivate),
      activityAt,
    };
  }

  private commit(value: unknown): CollectionContribution {
    const r = this.record(value);
    const author = r.author;
    const user =
      author === null || author === undefined
        ? null
        : (this.record(author).user ?? null);
    return {
      githubKey: this.string(r.oid),
      authorGithubId:
        user === null ? null : this.id(this.record(user).databaseId),
      occurredAt: new Date(this.date(r.committedDate)),
    };
  }

  private authored(r: Record<string, unknown>): CollectionContribution {
    return {
      githubKey: this.id(r.fullDatabaseId),
      authorGithubId: this.actorId(r.author),
      occurredAt: new Date(this.date(r.createdAt)),
    };
  }

  private release(r: Record<string, unknown>): CollectionContribution | null {
    if (this.boolean(r.isDraft) || r.publishedAt === null) return null;
    return {
      githubKey: this.id(r.databaseId),
      authorGithubId: this.actorId(r.author),
      occurredAt: new Date(this.date(r.publishedAt)),
    };
  }

  private actorId(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const databaseId = this.record(value).databaseId;
    return databaseId === null || databaseId === undefined
      ? null
      : this.id(databaseId);
  }

  private nodes(connection: Record<string, unknown>): unknown[] {
    const nodes = connection.nodes;
    if (!Array.isArray(nodes)) this.invalid();
    return nodes;
  }

  private nextCursor(connection: Record<string, unknown>): string | null {
    const pageInfo = this.record(connection.pageInfo);
    return this.boolean(pageInfo.hasNextPage)
      ? this.string(pageInfo.endCursor)
      : null;
  }

  private rateLimit(value: unknown): CollectionRateLimit | null {
    if (value === null || value === undefined) return null;
    const r = this.record(value);
    if (
      typeof r.cost !== 'number' ||
      !Number.isSafeInteger(r.cost) ||
      typeof r.remaining !== 'number' ||
      !Number.isSafeInteger(r.remaining)
    )
      this.invalid();
    return { cost: r.cost, remaining: r.remaining };
  }

  private async one(path: string): Promise<unknown> {
    const deadline = this.now() + this.config.deadlineMs;
    return this.request(
      new URL(path, `${this.config.apiBaseUrl}/`).toString(),
      deadline,
    );
  }

  private async request(url: string, deadline: number): Promise<unknown> {
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
        return (await response.json()) as unknown;
      } catch {
        throw new CollectionAppClientError('RESPONSE');
      }
    }
    throw new CollectionAppClientError('AUTH');
  }

  private async graphql(
    payload: { query: string; variables: Record<string, unknown> },
    deadline: number,
    aliasErrorsAsData = false,
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
        const errors = body.errors.map((error) => this.record(error));
        if (errors.some((error) => error.type === 'RATE_LIMITED')) {
          throw new CollectionAppClientError('RATE_LIMITED');
        }
        if (
          aliasErrorsAsData &&
          errors.every(
            (error) =>
              Array.isArray(error.path) &&
              typeof error.path[0] === 'string' &&
              /^r\d+$/.test(error.path[0]),
          )
        ) {
          return body;
        }
        throw new CollectionAppClientError('GRAPHQL_ERROR');
      }
      return body;
    }
    throw new CollectionAppClientError('AUTH');
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
    const r = this.record(v);
    return {
      id: this.id(r.id),
      fullName: this.string(r.full_name),
      private: this.boolean(r.private),
      archived: this.boolean(r.archived),
      defaultBranch:
        r.default_branch === null ? null : this.string(r.default_branch),
    };
  }
  private id(v: unknown): string {
    if (
      (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) ||
      (typeof v === 'string' && /^[1-9]\d*$/.test(v))
    )
      return String(v);
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
  private invalid(): never {
    throw new CollectionAppClientError('RESPONSE');
  }
}
