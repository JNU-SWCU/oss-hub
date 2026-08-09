import type {
  CollectionAppClient,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
  CollectionRepository,
} from '../src/github/collection-app.client';
import type { CollectionAppTokenProvider } from '../src/github/collection-app.token';
import type { CollectionReconciliationRuntime } from '../src/github/service/collection-reconciliation.service';

export const SYNTHETIC_APP_ID = '9000000000001001';
export const SYNTHETIC_ORGANIZATION_ID = '9000000000001002';
export const SYNTHETIC_ORGANIZATION = 'synthetic-org';

export interface CollectionAppInventoryFixture {
  repositories: CollectionRepository[];
  commits: Record<string, CollectionCommit[]>;
  pullRequests: Record<string, CollectionPullRequest[]>;
  releases: Record<string, CollectionRelease[]>;
}

export const syntheticRepository = (
  overrides: Partial<CollectionRepository> = {},
): CollectionRepository => ({
  id: '9000000000001101',
  name: 'public-project',
  fullName: `${SYNTHETIC_ORGANIZATION}/public-project`,
  private: false,
  archived: false,
  defaultBranch: 'main',
  ownerLogin: SYNTHETIC_ORGANIZATION,
  htmlUrl: 'https://example.invalid/synthetic-org/public-project',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const createCollectionAppRuntime = (
  inventory: CollectionAppInventoryFixture,
): CollectionReconciliationRuntime => {
  const tokens = {
    getInstallationIdentity: jest.fn().mockResolvedValue({
      appId: SYNTHETIC_APP_ID,
      organizationId: SYNTHETIC_ORGANIZATION_ID,
    }),
    getToken: jest.fn().mockResolvedValue('synthetic-token'),
  } as unknown as CollectionAppTokenProvider;
  const client = {
    listInstallationRepositories: jest
      .fn()
      .mockResolvedValue(inventory.repositories),
    getRepository: jest.fn((owner: string, name: string) => {
      const repository = inventory.repositories.find(
        (item) => item.ownerLogin === owner && item.name === name,
      );
      return repository
        ? Promise.resolve(repository)
        : Promise.reject(new Error('synthetic repository missing'));
    }),
    listDefaultBranchCommits: jest.fn((_owner: string, name: string) =>
      Promise.resolve(inventory.commits[name] ?? []),
    ),
    listPullRequests: jest.fn((_owner: string, name: string) =>
      Promise.resolve(inventory.pullRequests[name] ?? []),
    ),
    listPublishedReleases: jest.fn((_owner: string, name: string) =>
      Promise.resolve(inventory.releases[name] ?? []),
    ),
  } as unknown as CollectionAppClient;
  return {
    appId: SYNTHETIC_APP_ID,
    organizationLogin: SYNTHETIC_ORGANIZATION,
    tokens,
    client,
  };
};
