import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AdminAccessHttpHarness } from './admin-access.http.integration-support';
import {
  parseAdminAccessHistoryAsPreviousFrontend,
  serializeAdminAccessHistoryQueryAsPreviousFrontend,
} from './previous-frontend-contract.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

/**
 * bridge 배포 중에는 **직전 프런트엔드 번들이 살아 있다.**
 *
 * 백엔드를 먼저 교체하므로, 사용자의 브라우저에는 한동안 v0.6.110이 빌드한 JS가
 * 남는다. 그 번들은 `roleRequestPage`/`roleRequestLimit`을 보내고 응답에서
 * `roleRequests`를 **런타임에 검증**한다 — 없으면 `AdminAccessResponseError`를
 * 던진다. 그래서 이 계약은 타입이 아니라 실제 HTTP 왕복으로만 증명된다.
 *
 * 이 스펙은 그 번들의 직렬화·파서를 그대로 옮겨 온 fixture로 왕복을 돌린다
 * (`previous-frontend-contract.fixture.ts`). bridge 전용이며, contract PR이
 * 호환 shim을 걷어낼 때 이 파일도 함께 사라진다.
 */
const harness = new AdminAccessHttpHarness(
  'previous-frontend-compat',
  9_003_970_000n,
);

beforeAll(async () => {
  await harness.start();
});

afterAll(async () => {
  await harness.stop();
});

it('직전 프런트엔드의 legacy 질의를 400 없이 받고 그 파서가 읽는 응답을 준다', async () => {
  // Given — 직전 번들이 실제로 만드는 질의 문자열이다.
  const actor = await harness.createUser(
    'legacy-query-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'legacy-query-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  await harness.createPendingRequest(target.id);
  const query = serializeAdminAccessHistoryQueryAsPreviousFrontend({
    roleRequestPage: 1,
    roleRequestLimit: 5,
    loginPage: 1,
    loginLimit: 7,
  });

  // When
  const response = await harness.request(
    'GET',
    `/users/${target.id}/access/history?${query}`,
    actor.githubId,
  );

  // Then — `forbidNonWhitelisted: true`라 legacy 키를 모르면 여기서 400이 난다.
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const parsed = parseAdminAccessHistoryAsPreviousFrontend(body);
  expect(parsed.roleRequests.page).toBe(1);
  expect(parsed.roleRequests.limit).toBe(5);
  expect(parsed.roleRequests.total).toBe(1);
  expect(parsed.roleRequests.items).toHaveLength(1);
  expect(parsed.loginHistory.page).toBe(1);
  expect(parsed.loginHistory.limit).toBe(7);
});

it('legacy 별칭과 정본 이름이 같은 페이지를 가리킨다', async () => {
  // Given
  const actor = await harness.createUser(
    'alias-parity-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'alias-parity-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  await harness.createPendingRequest(target.id);

  // When — 같은 뜻을 legacy 철자와 정본 철자로 각각 보낸다.
  const [legacy, canonical] = await Promise.all([
    harness.request(
      'GET',
      `/users/${target.id}/access/history?roleRequestPage=1&roleRequestLimit=3`,
      actor.githubId,
    ),
    harness.request(
      'GET',
      `/users/${target.id}/access/history?staffAccessRequestPage=1&staffAccessRequestLimit=3`,
      actor.githubId,
    ),
  ]);

  // Then
  expect([legacy.status, canonical.status]).toEqual([200, 200]);
  const legacyBody = (await legacy.json()) as Record<string, unknown>;
  const canonicalBody = (await canonical.json()) as Record<string, unknown>;
  expect(legacyBody).toEqual(canonicalBody);
});

it('한 응답이 정본과 legacy 철자를 같은 값으로 함께 싣는다', async () => {
  // Given
  const actor = await harness.createUser(
    'dual-spelling-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'dual-spelling-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  await harness.createPendingRequest(target.id);

  // When
  const response = await harness.request(
    'GET',
    `/users/${target.id}/access/history`,
    actor.githubId,
  );

  // Then — 두 철자는 **같은 sanitize된 값**이어야 한다. 한쪽만 원본을 노출하면
  // 그 자체가 유출이다.
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.roleRequests).toEqual(body.staffAccessRequests);
  expect(body.roleRequests).not.toBeUndefined();
});

it('두 철자가 서로 다른 값을 동시에 실으면 400으로 거절한다', async () => {
  // Given
  const actor = await harness.createUser(
    'conflict-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'conflict-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );

  // When — 어느 쪽을 따를지 서버가 임의로 정하면 관리자가 본 페이지와 서버가 센
  // 페이지가 조용히 갈라진다. 그래서 추측하지 않고 거절한다.
  const response = await harness.request(
    'GET',
    `/users/${target.id}/access/history?roleRequestPage=1&staffAccessRequestPage=2`,
    actor.githubId,
  );

  // Then
  expect(response.status).toBe(400);
});

it('두 철자가 같은 값이면 충돌이 아니다', async () => {
  // Given
  const actor = await harness.createUser(
    'agreeing-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'agreeing-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'GET',
    `/users/${target.id}/access/history?roleRequestPage=2&staffAccessRequestPage=2&roleRequestLimit=4&staffAccessRequestLimit=4`,
    actor.githubId,
  );

  // Then
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    readonly staffAccessRequests: {
      readonly page: number;
      readonly limit: number;
    };
  };
  expect(body.staffAccessRequests.page).toBe(2);
  expect(body.staffAccessRequests.limit).toBe(4);
});
