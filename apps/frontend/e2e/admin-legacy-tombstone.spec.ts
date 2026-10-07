import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';

const REMOVED_ACCESS_PATH = ['', 'admin', 'access'].join('/');
const REMOVED_USERS_PATH = ['', 'admin', 'users'].join('/');
const REMOVED_STAFF_REQUESTS_PATH = ['', 'admin', 'staff-requests'].join('/');

test.describe('레거시 관리자 화면·API는 전환 이후 tombstone 상태다(PR04H)', () => {
  test('구 접근 관리 화면은 리다이렉트 없이 404를 반환한다', async ({
    adminPage,
    expectAdminResourceStatusError,
  }) => {
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_ACCESS_PATH}`;
    expectAdminResourceStatusError(404);

    const pageResponse = await adminPage.goto(REMOVED_ACCESS_PATH);

    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);
  });

  test('레거시 사용자 관리 화면과 목록 API는 리다이렉트 없이 404를 반환한다', async ({
    adminPage,
    expectAdminResourceStatusError,
  }) => {
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_USERS_PATH}`;
    expectAdminResourceStatusError(404);

    const pageResponse = await adminPage.goto(REMOVED_USERS_PATH);

    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);

    const apiResponse = await adminPage.request.get(
      `${e2eEnvironment.baseUrl}${e2eEnvironment.legacyContracts.users}`,
      { maxRedirects: 0 },
    );
    expect(apiResponse.status()).toBe(404);
  });

  test('레거시 교직원 요청 화면과 승인 API는 리다이렉트 없이 404를 반환한다', async ({
    adminPage,
    expectAdminResourceStatusError,
  }) => {
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_STAFF_REQUESTS_PATH}`;
    expectAdminResourceStatusError(404);

    const pageResponse = await adminPage.goto(REMOVED_STAFF_REQUESTS_PATH);

    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);

    const apiResponse = await adminPage.request.get(
      `${e2eEnvironment.baseUrl}${e2eEnvironment.legacyContracts.staffRequests}?requestedRole=STAFF&status=PENDING`,
      { maxRedirects: 0 },
    );
    expect(apiResponse.status()).toBe(404);
  });
});
