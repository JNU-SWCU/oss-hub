import { createHash } from 'node:crypto';
import {
  CollectionAppClient,
  CollectionRepository,
} from './collection-app.client';
import { CollectionAppTokenProvider } from './collection-app.token';

export const COLLECTION_LIVE_SMOKE_SCHEMA_VERSION = '1';
export const COLLECTION_LIVE_SMOKE_ENDPOINTS = [
  'installation',
  'repositories',
  'metadata',
  'default-branch-commits',
  'all-state-pull-requests',
  'published-releases',
] as const;

type EndpointCategory = (typeof COLLECTION_LIVE_SMOKE_ENDPOINTS)[number];
export interface CollectionLiveSmokeAlias {
  label: string;
  repository: string;
  visibility: 'public' | 'private';
}
export interface CollectionLiveSmokeOutput {
  schemaVersion: string;
  timestamp: string;
  aliases: string[];
  endpointCategories: readonly EndpointCategory[];
  normalizedStatus: 'PASS' | 'FAIL';
  complete: boolean;
  idempotent: boolean;
  digest: string;
  result: 'PASS' | 'FAIL';
}

export class CollectionLiveSmokeService {
  constructor(
    private readonly client: CollectionAppClient,
    private readonly tokens: CollectionAppTokenProvider,
    private readonly owner: string,
    private readonly aliases: CollectionLiveSmokeAlias[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(): Promise<CollectionLiveSmokeOutput> {
    const labels = this.aliases.map(({ label }) => label).sort();
    let first = '';
    let second = '';
    let complete = false;
    try {
      this.validateFixtures();
      first = await this.readNormalizedPass();
      second = await this.readNormalizedPass();
      complete = true;
    } catch {
      first = this.normalized('FAIL');
      second = first;
    }
    const idempotent = complete && first === second;
    const passed = complete && idempotent;
    return {
      schemaVersion: COLLECTION_LIVE_SMOKE_SCHEMA_VERSION,
      timestamp: this.now().toISOString(),
      aliases: labels,
      endpointCategories: COLLECTION_LIVE_SMOKE_ENDPOINTS,
      normalizedStatus: passed ? 'PASS' : 'FAIL',
      complete,
      idempotent,
      digest: createHash('sha256').update(first).digest('hex'),
      result: passed ? 'PASS' : 'FAIL',
    };
  }

  private validateFixtures(): void {
    if (
      this.aliases.length === 0 ||
      !this.owner ||
      this.aliases.some((alias) => !alias.label || !alias.repository) ||
      new Set(this.aliases.map(({ label }) => label)).size !==
        this.aliases.length ||
      !this.aliases.some(({ visibility }) => visibility === 'private')
    ) {
      throw new Error('Live smoke fixture configuration is incomplete');
    }
  }

  private async readNormalizedPass(): Promise<string> {
    await this.tokens.getInstallationIdentity();
    const installed = await this.client.listInstallationRepositories();
    const observations: unknown[] = [];
    for (const alias of this.aliases) {
      const selected = installed.find(
        (repository) =>
          repository.ownerLogin.toLowerCase() === this.owner.toLowerCase() &&
          repository.name === alias.repository,
      );
      if (!selected || selected.private !== (alias.visibility === 'private')) {
        throw new Error('Installation repository selection drift');
      }
      const metadata = await this.client.getRepository(
        this.owner,
        alias.repository,
      );
      this.assertSameRepository(selected, metadata);
      const commits = await this.client.listDefaultBranchCommits(
        this.owner,
        alias.repository,
        metadata.defaultBranch,
      );
      const pullRequests = await this.client.listPullRequests(
        this.owner,
        alias.repository,
      );
      const releases = await this.client.listPublishedReleases(
        this.owner,
        alias.repository,
      );
      observations.push({
        label: alias.label,
        visibility: alias.visibility,
        metadata: {
          archived: metadata.archived,
          defaultBranch: metadata.defaultBranch,
          updatedAt: metadata.updatedAt,
        },
        commits: commits
          .map(({ sha, committedAt }) => ({ sha, committedAt }))
          .sort(this.compare),
        pullRequests: pullRequests
          .map(({ number, state, draft, mergedAt, createdAt, updatedAt }) => ({
            number,
            state,
            draft,
            mergedAt,
            createdAt,
            updatedAt,
          }))
          .sort(this.compare),
        releases: releases
          .map(({ tagName, publishedAt }) => ({ tagName, publishedAt }))
          .sort(this.compare),
      });
    }
    return JSON.stringify({
      status: 'PASS',
      observations: observations.sort(this.compare),
    });
  }

  private assertSameRepository(
    selected: CollectionRepository,
    metadata: CollectionRepository,
  ): void {
    if (
      selected.id !== metadata.id ||
      selected.name !== metadata.name ||
      selected.ownerLogin.toLowerCase() !== metadata.ownerLogin.toLowerCase() ||
      selected.private !== metadata.private
    ) {
      throw new Error('Repository metadata drift');
    }
  }

  private normalized(status: 'FAIL'): string {
    return JSON.stringify({
      status,
      aliases: this.aliases.map(({ label }) => label).sort(),
    });
  }

  private readonly compare = (left: unknown, right: unknown): number =>
    JSON.stringify(left).localeCompare(JSON.stringify(right));
}
