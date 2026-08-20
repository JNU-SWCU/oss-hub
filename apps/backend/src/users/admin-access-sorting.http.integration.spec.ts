import { AccountStatus, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AdminAccessHttpHarness } from './admin-access.http.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = new AdminAccessHttpHarness('sorting', 9_004_000_000n);
let actorGithubId: bigint;

beforeAll(async () => {
  await harness.start();
  actorGithubId = (
    await harness.createUser('actor', Role.ADMIN, AccountStatus.ACTIVE)
  ).githubId;
});

afterAll(() => harness.stop());

it.each([
  ['name', 'asc'],
  ['createdAt', 'desc'],
  ['lastLoginAt', 'asc'],
  ['role', 'desc'],
  ['accountStatus', 'asc'],
] as const)('accepts sort=%s&direction=%s', async (sort, direction) => {
  // Given: the authenticated ADMIN actor created in beforeAll
  // When
  const response = await harness.request(
    'GET',
    `/users/access?sort=${sort}&direction=${direction}`,
    actorGithubId,
  );

  // Then
  expect(response.status).toBe(200);
});

it.each([
  [
    'sort',
    'sort=arbitrary',
    'sort must be one of the following values: name, createdAt, lastLoginAt, role, accountStatus',
  ],
  [
    'direction',
    'direction=sideways',
    'direction must be one of the following values: asc, desc',
  ],
] as const)(
  'returns the exact RFC7807 problem for invalid %s',
  async (_label, query, detail) => {
    // Given: the authenticated ADMIN actor created in beforeAll
    // When
    const response = await harness.request(
      'GET',
      `/users/access?${query}`,
      actorGithubId,
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      title: 'BAD_REQUEST',
      status: 400,
      detail,
      instance: '/api/v1/users/access',
      code: 'SYS_003',
    });
  },
);
