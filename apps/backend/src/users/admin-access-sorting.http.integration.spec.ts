import { AccountStatus } from '@prisma/client';
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
    await harness.createUser('actor', 'ADMIN', AccountStatus.ACTIVE)
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

it('returns account createdAt on the admin directory response without exposing phone', async () => {
  // Given
  const accountCreatedAt = new Date('2026-07-29T00:00:00.000Z');
  const target = await harness.createUser(
    'created-at-target',
    'STUDENT',
    AccountStatus.ACTIVE,
  );
  await harness.prisma.user.update({
    where: { id: target.id },
    data: { createdAt: accountCreatedAt },
  });

  // When
  const response = await harness.request(
    'GET',
    `/users/access?query=${target.nickname}`,
    actorGithubId,
  );

  // Then
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          createdAt: accountCreatedAt.toISOString(),
        }),
      ],
    }),
  );
  expect(JSON.stringify(body)).not.toContain('phone');
});
