import { GithubObservation } from './domain/github-observation';
import { JsonObject, JsonValue } from './domain/json';
import {
  RateLimitedError,
  UpstreamError,
  UpstreamResponseError,
} from './github-api.error';

const API_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = 'oss-hub-backend';
const FALLBACK_RETRY_DELAY_MS = 60_000;
const MAX_EVENT_PAGES = 3;

export interface GithubApiCredentials {
  clientId: string;
  clientSecret: string;
}

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export class GithubApiClient {
  private authorization: string | null = null;

  constructor(
    private readonly credentialsProvider: () => GithubApiCredentials,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 자격증명은 첫 요청 시점에 해석한다 — 미구성 dev 환경에서도 앱 부팅은 가능해야 한다. */
  private authorizationHeader(): string {
    if (this.authorization === null) {
      const credentials = this.credentialsProvider();
      this.authorization = `Basic ${Buffer.from(
        `${credentials.clientId}:${credentials.clientSecret}`,
      ).toString('base64')}`;
    }
    return this.authorization;
  }

  async getUser(login: string): Promise<GithubObservation[]> {
    const body = await this.request(
      `${API_BASE_URL}/users/${encodeURIComponent(login)}`,
    );
    return [this.parseObservation(body)];
  }

  async getRepos(login: string): Promise<GithubObservation[]> {
    const initialUrl = `${API_BASE_URL}/users/${encodeURIComponent(
      login,
    )}/repos?per_page=100`;
    return this.getPages(initialUrl);
  }

  async getPublicEvents(login: string): Promise<GithubObservation[]> {
    const initialUrl = `${API_BASE_URL}/users/${encodeURIComponent(
      login,
    )}/events/public?per_page=100`;
    return this.getPages(initialUrl, MAX_EVENT_PAGES);
  }

  private async getPages(
    initialUrl: string,
    maxPages = Number.POSITIVE_INFINITY,
  ): Promise<GithubObservation[]> {
    const observations: GithubObservation[] = [];
    const visited = new Set<string>();
    let nextUrl: string | null = initialUrl;
    let page = 0;

    while (nextUrl && page < maxPages) {
      if (visited.has(nextUrl)) {
        throw new UpstreamResponseError();
      }
      visited.add(nextUrl);
      const { body, link } = await this.requestPage(nextUrl);
      if (!Array.isArray(body)) {
        throw new UpstreamResponseError();
      }
      observations.push(...body.map((item) => this.parseObservation(item)));
      nextUrl = this.parseNextUrl(link);
      page += 1;
    }

    return observations;
  }

  private async request(url: string): Promise<unknown> {
    const response = await this.fetchResponse(url);
    return this.readJson(response);
  }

  private async requestPage(
    url: string,
  ): Promise<{ body: unknown; link: string | null }> {
    const response = await this.fetchResponse(url);
    return {
      body: await this.readJson(response),
      link: response.headers.get('link'),
    };
  }

  private async fetchResponse(url: string): Promise<Response> {
    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: this.authorizationHeader(),
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': API_VERSION,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (await this.isRateLimited(response)) {
        throw new RateLimitedError(this.retryNotBeforeAt(response.headers));
      }
      throw new UpstreamError(response.status);
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      const body: unknown = await response.json();
      return body;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new UpstreamResponseError();
      }
      throw error;
    }
  }

  private async isRateLimited(response: Response): Promise<boolean> {
    if (response.status === 429) {
      return true;
    }
    if (response.status !== 403) {
      return false;
    }
    if (
      response.headers.get('x-ratelimit-remaining') === '0' ||
      response.headers.get('retry-after') !== null
    ) {
      return true;
    }

    try {
      const body: unknown = await response.clone().json();
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return false;
      }
      if (!('message' in body)) {
        return false;
      }
      const message = body.message;
      return (
        typeof message === 'string' &&
        message.toLowerCase().includes('secondary rate limit')
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        return false;
      }
      throw error;
    }
  }

  private retryNotBeforeAt(headers: Headers): Date {
    const retryAfter = headers.get('retry-after');
    if (retryAfter && /^\d+$/.test(retryAfter)) {
      return new Date(this.now().getTime() + Number(retryAfter) * 1_000);
    }

    const reset = headers.get('x-ratelimit-reset');
    if (reset && /^\d+$/.test(reset)) {
      return new Date(Number(reset) * 1_000);
    }

    return new Date(this.now().getTime() + FALLBACK_RETRY_DELAY_MS);
  }

  private parseObservation(value: unknown): GithubObservation {
    const payload = this.parseJsonObject(value);
    const id = payload.id;
    if (!(
      (typeof id === 'string' && id.length > 0) ||
      (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
    )) {
      throw new UpstreamResponseError();
    }
    return { sourceId: String(id), payload };
  }

  private parseJsonObject(value: unknown): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new UpstreamResponseError();
    }

    const parsed: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      parsed[key] = this.parseJsonValue(item);
    }
    return parsed;
  }

  private parseJsonValue(value: unknown): JsonValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.parseJsonValue(item));
    }
    return this.parseJsonObject(value);
  }

  private parseNextUrl(link: string | null): string | null {
    if (!link) {
      return null;
    }

    for (const part of link.split(',')) {
      const match = part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/);
      if (match?.[2] !== 'next' || !match[1]) {
        continue;
      }
      const next = new URL(match[1], API_BASE_URL);
      if (next.origin !== API_BASE_URL) {
        throw new UpstreamResponseError();
      }
      return next.toString();
    }
    return null;
  }
}
