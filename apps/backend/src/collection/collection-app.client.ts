import { CollectionAppConfigValues } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';

const API_VERSION = '2022-11-28';
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CollectionAppErrorKind =
  | 'UPSTREAM'
  | 'RESPONSE'
  | 'PAGINATION'
  | 'DEADLINE'
  | 'RATE_LIMITED'
  | 'AUTH'
  | 'PERMISSION';
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

export class CollectionAppClient {
  constructor(
    private readonly config: CollectionAppConfigValues,
    private readonly tokens: CollectionAppTokenProvider,
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
    return (
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

  private async pages<T>(
    path: string,
    normalize: (value: unknown) => T,
    envelope?: string,
    emptyRepositoryIsEmpty = false,
  ): Promise<T[]> {
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
      const response = await this.request(
        next,
        deadline,
        emptyRepositoryIsEmpty,
      );
      const container = envelope
        ? this.record(response.body)[envelope]
        : response.body;
      if (!Array.isArray(container)) this.invalid();
      result.push(...container.map(normalize));
      next = this.nextLink(response.link);
    }
    return result;
  }

  private async request(
    url: string,
    deadline: number,
    emptyRepositoryIsEmpty = false,
  ): Promise<{ body: unknown; link: string | null }> {
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
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'oss-hub-collection-app',
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
          return { body: [], link: null };
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
        throw new CollectionAppClientError('UPSTREAM');
      }
      try {
        return {
          body: await response.json(),
          link: response.headers.get('link'),
        };
      } catch {
        throw new CollectionAppClientError('RESPONSE');
      }
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
