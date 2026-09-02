import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';

const REMOVED_ACCESS_PATH = ['', 'admin', 'access'].join('/');
const REMOVED_USERS_PATH = ['', 'admin', 'users'].join('/');
const REMOVED_STAFF_REQUESTS_PATH = ['', 'admin', 'staff-requests'].join('/');

// PR04H — 관리자 접근 화면을 /dashboard/users 단일 작업공간으로 원자적으로 전환한
// 뒤, 레거시 화면·API가 리다이렉트 없이 순수 404로 사라졌는지 증명하는
// tombstone E2E다. 이전에는 이 파일이 레거시 경로가 "여전히 동작함"을
// 증명했지만(admin-legacy-compat.spec.ts), 전환 이후에는 그 반대 —
// "더 이상 존재하지 않음" — 을 증명한다. ADMIN 세션으로 검증하는 이유는
// 권한이 충분한 사용자조차 화면 자체가 없어 404를 받는다는 것을 보여
// 권한 문제(403)와 부재(404)를 구분하기 위해서다.

test.describe('레거시 관리자 화면·API는 전환 이후 tombstone 상태다(PR04H)', () => {
  test('구 접근 관리 화면은 리다이렉트 없이 404를 반환한다', async ({
    adminPage,
    expectAdminResourceStatusError,
  }) => {
    // Given: 충분한 권한이 있어도 역할이 드러나는 구 화면 주소는 사라졌다.
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_ACCESS_PATH}`;
    expectAdminResourceStatusError(404);

    // When: 관리자가 제거된 주소를 직접 연다.
    const pageResponse = await adminPage.goto(REMOVED_ACCESS_PATH);

    // Then: 새 주소로 보내지 않고 요청한 주소에서 404를 반환한다.
    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);
  });

  test('레거시 사용자 관리 화면과 목록 API는 리다이렉트 없이 404를 반환한다', async ({
    adminPage,
    expectAdminResourceStatusError,
  }) => {
    // Given: an injected ADMIN session — 권한은 충분하지만 화면이 사라졌다.
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_USERS_PATH}`;
    expectAdminResourceStatusError(404);

    // When: the real browser opens the removed admin users page.
    const pageResponse = await adminPage.goto(REMOVED_USERS_PATH);

    // Then: AdminUsersController가 모듈 등록에서 빠졌고 페이지도 삭제됐으므로,
    // 별도 리다이렉트 핸들러 없이 순수 404를 받는다 — 최종 URL도 요청한
    // 그대로다(리다이렉트가 있었다면 달라졌을 것이다).
    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);

    // And: 백엔드 레거시 목록 API도 원자적 전환 이후 플레인 404다.
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
    // Given: an injected ADMIN session — 권한은 충분하지만 화면이 사라졌다.
    const requestedUrl = `${e2eEnvironment.baseUrl}${REMOVED_STAFF_REQUESTS_PATH}`;
    expectAdminResourceStatusError(404);

    // When: the real browser opens the removed staff requests page.
    const pageResponse = await adminPage.goto(REMOVED_STAFF_REQUESTS_PATH);

    // Then: StaffAccessRequestsController가 모듈 등록에서 빠졌고 페이지도
    // 삭제됐으므로, 리다이렉트 없이 순수 404를 받는다.
    expect(pageResponse?.status()).toBe(404);
    expect(adminPage.url()).toBe(requestedUrl);

    // And: 레거시 승인 목록 API(옛 ADMIN 전용 GET /role-requests)도 404다.
    // 셀프서비스 GET /role-requests/me·POST /role-requests는 같은 베이스
    // 경로에서 살아남지만, 이 요청은 그 서브경로들과 겹치지 않는다.
    const apiResponse = await adminPage.request.get(
      `${e2eEnvironment.baseUrl}${e2eEnvironment.legacyContracts.staffRequests}?requestedRole=STAFF&status=PENDING`,
      { maxRedirects: 0 },
    );
    expect(apiResponse.status()).toBe(404);
  });
});
