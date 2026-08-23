import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  F3_LOGOUT_ORIGIN_PATH,
  installLogoutFixture,
} from './support/f3-account-fixture';
import { captureF3Evidence } from './support/f3-evidence';

const ACCOUNT_MENU_LABEL = 'synthetic-f3-account 계정 메뉴';

/** 헤더 계정 메뉴를 열고 로그아웃을 누른다 — 사용자가 실제로 지나는 유일한 경로다. */
async function clickLogout(page: Page): Promise<void> {
  await page.getByRole('button', { name: ACCOUNT_MENU_LABEL }).click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
}

/**
 * 로그아웃이 성공했을 때 — 완료 화면에 **자기 주소로** 착지하는가.
 *
 * 안내를 `/?loggedOut=1` 쿼리 표식으로 두던 시절에는 새로고침 한 번에 안내가 사라졌다
 * (logout-notice.ts). 그래서 "안내 문구가 보인다"가 아니라 **주소가 `/logout`이고
 * 떠나온 자리가 복귀 주소로 실려 있는가**를 본다 — 표식 방식으로 되돌아가면 이 단언이
 * 먼저 깨진다.
 */
test('logout success lands on the logout complete screen with a return path', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installLogoutFixture(page, 'success');

  await page.goto(F3_LOGOUT_ORIGIN_PATH);
  await clickLogout(page);

  await expect(page).toHaveURL(/\/logout\?returnTo=%2Fsettings$/);
  await expect(
    page.getByRole('heading', { name: '로그아웃되었습니다' }),
  ).toBeVisible();
  expect(fixture.logoutRequests()).toBe(1);

  await captureF3Evidence(page, testInfo, 'logout-success');
  audit.assertClean();
});

/**
 * 로그아웃이 실패했을 때 — 세션을 잃은 척하지 않는가.
 *
 * 요청이 실패했는데 화면만 로그아웃된 것처럼 접으면, 실제로는 살아 있는 세션을 두고
 * 사용자가 떠난다. 그래서 실패 경로의 계약은 세 가지가 함께 성립하는 것이다:
 * 오류를 말하고(alert), 있던 자리에 남고(URL), 계정 메뉴가 그대로 있다.
 *
 * 의도한 500은 허용 목록에 넣는다 — 단, 이 시나리오가 고장 낸 **로그아웃 POST 하나**만이다.
 * 상태 코드만 적으면 그 실행의 모든 500이 같이 통과해, 관계없는 화면의 서버 오류까지
 * 조용히 들어온다. 그 밖의 콘솔·페이지·네트워크 오류는 그대로 실패다.
 */
test('logout failure keeps the authenticated view and reports the error', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installLogoutFixture(page, 'failure');

  await page.goto(F3_LOGOUT_ORIGIN_PATH);
  await clickLogout(page);

  // 계정 메뉴 옆에 서는 로그아웃 오류만 골라 본다 — 본문에도 alert가 있을 수 있고,
  // 이 시나리오가 잠근 것은 헤더가 실패를 말하는가다.
  await expect(
    page.getByRole('alert').filter({
      hasText: '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole('button', { name: ACCOUNT_MENU_LABEL }),
  ).toBeVisible();
  expect(fixture.logoutRequests()).toBe(1);

  await captureF3Evidence(page, testInfo, 'logout-failure');
  audit.assertClean([
    { status: 500, path: '/api/v1/auth/logout', method: 'POST' },
  ]);
});
