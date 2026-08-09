import {
  CollectionAppClient,
  CollectionRepository,
} from '../collection-app.client';
import { CollectionAppTokenProvider } from '../collection-app.token';
import { CollectionLiveSmokeService } from './collection-live-smoke.service';

const PUBLIC_NAME = 'synthetic-public-repository';
const PRIVATE_NAME = 'synthetic-private-repository-do-not-print';
const TOKEN = 'synthetic-secret-token-do-not-print';

function repository(
  id: string,
  name: string,
  privateRepository: boolean,
): CollectionRepository {
  return {
    id,
    name,
    fullName: `synthetic-org/${name}`,
    private: privateRepository,
    archived: false,
    defaultBranch: 'main',
    ownerLogin: 'synthetic-org',
    htmlUrl: `https://example.invalid/${name}`,
    updatedAt: '2026-07-25T00:00:00.000Z',
  };
}

function fixture() {
  const publicRepository = repository('1', PUBLIC_NAME, false);
  const privateRepository = repository('2', PRIVATE_NAME, true);
  const client = {
    listInstallationRepositories: jest
      .fn()
      .mockResolvedValue([publicRepository, privateRepository]),
    getRepository: jest.fn((_owner: string, name: string) =>
      Promise.resolve(
        name === PUBLIC_NAME ? publicRepository : privateRepository,
      ),
    ),
    listDefaultBranchCommits: jest
      .fn()
      .mockResolvedValue([{ sha: 'abc', committedAt: '2026-07-25T00:00:00Z' }]),
    listPullRequests: jest.fn().mockResolvedValue([
      {
        number: 1,
        state: 'closed',
        draft: false,
        mergedAt: null,
        createdAt: '2026-07-24T00:00:00Z',
        updatedAt: '2026-07-25T00:00:00Z',
      },
    ]),
    listPublishedReleases: jest
      .fn()
      .mockResolvedValue([
        { tagName: 'v1', publishedAt: '2026-07-25T00:00:00Z' },
      ]),
  };
  const tokens = {
    getInstallationIdentity: jest
      .fn()
      .mockResolvedValue({ appId: '1', organizationId: '2' }),
  };
  const service = new CollectionLiveSmokeService(
    client as unknown as CollectionAppClient,
    tokens as unknown as CollectionAppTokenProvider,
    'synthetic-org',
    [
      {
        label: 'public-fixture',
        repository: PUBLIC_NAME,
        visibility: 'public',
      },
      {
        label: 'private-fixture',
        repository: PRIVATE_NAME,
        visibility: 'private',
      },
    ],
    () => new Date('2026-07-25T12:00:00.000Z'),
  );
  return { service, client, tokens };
}

describe('CollectionLiveSmokeService', () => {
  it('reads every resource twice and produces an idempotent digest', async () => {
    const { service, client, tokens } = fixture();
    const output = await service.verify();

    expect(output).toMatchObject({
      result: 'PASS',
      complete: true,
      idempotent: true,
    });
    expect(tokens.getInstallationIdentity).toHaveBeenCalledTimes(2);
    expect(client.listInstallationRepositories).toHaveBeenCalledTimes(2);
    expect(client.getRepository).toHaveBeenCalledTimes(4);
    expect(client.listDefaultBranchCommits).toHaveBeenCalledTimes(4);
    expect(client.listPullRequests).toHaveBeenCalledTimes(4);
    expect(client.listPublishedReleases).toHaveBeenCalledTimes(4);
    expect(client.listDefaultBranchCommits).toHaveBeenCalledWith(
      'synthetic-org',
      PRIVATE_NAME,
      'main',
    );
    expect(output.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on installation permission drift', async () => {
    const { service, tokens } = fixture();
    tokens.getInstallationIdentity.mockRejectedValue(new Error('PERMISSIONS'));

    await expect(service.verify()).resolves.toMatchObject({
      result: 'FAIL',
      complete: false,
      idempotent: false,
      normalizedStatus: 'FAIL',
    });
  });

  it('fails closed when the private fixture is absent', async () => {
    const { client, tokens } = fixture();
    const service = new CollectionLiveSmokeService(
      client as unknown as CollectionAppClient,
      tokens as unknown as CollectionAppTokenProvider,
      'synthetic-org',
      [
        {
          label: 'public-fixture',
          repository: PUBLIC_NAME,
          visibility: 'public',
        },
      ],
    );

    await expect(service.verify()).resolves.toMatchObject({
      result: 'FAIL',
      complete: false,
    });
    expect(client.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it('redacts credentials, repository names, raw counts, and user data', async () => {
    const { service } = fixture();
    const serialized = JSON.stringify(await service.verify());

    expect(serialized).toContain('public-fixture');
    expect(serialized).toContain('private-fixture');
    expect(serialized).not.toContain(PUBLIC_NAME);
    expect(serialized).not.toContain(PRIVATE_NAME);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('authorLogin');
    expect(serialized).not.toContain('count');
  });

  it('returns the same digest when repeat observations are reordered', async () => {
    const { service, client } = fixture();
    client.listInstallationRepositories
      .mockResolvedValueOnce([
        repository('2', PRIVATE_NAME, true),
        repository('1', PUBLIC_NAME, false),
      ])
      .mockResolvedValueOnce([
        repository('1', PUBLIC_NAME, false),
        repository('2', PRIVATE_NAME, true),
      ]);

    const first = await service.verify();
    const second = await service.verify();
    expect(first.result).toBe('PASS');
    expect(second.result).toBe('PASS');
    expect(first.digest).toBe(second.digest);
  });
});
