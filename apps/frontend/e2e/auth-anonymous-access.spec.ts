import { expect, test } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import { captureF3Evidence } from './support/f3-evidence';

/**
 * 비로그인으로 보호된 화면에 들어왔을 때 — 안내가 **그 자리에** 서는가.
 *
 * 예전에는 조용히 랜딩으로 되돌렸다(role-gate.tsx의 QA46 주석). 그때 사용자는 왜
 * 튕겼는지 듣지 못해 같은 시도를 반복했다. 그래서 판정은 "안내가 보인다"만으로는
 * 부족하고 **주소가 그대로인가**를 함께 봐야 한다 — 되돌리기가 되살아나면 안내만
 * 잠깐 스치고 주소가 바뀐다.
 *
 * 세션 쿠키도 라우트 가로채기도 쓰지 않는다. 이 시나리오가 지키는 계약이 "인증 없는
 * 진짜 요청"이라, 합성 세션을 끼우면 검증 대상 자체가 사라진다.
 */
test('anonymous visitor gets the login notice in place on a protected route', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);

  await page.goto('/dashboard');

  const notice = page.locator('#login-required-heading');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(
    page.locator('section[aria-labelledby="login-required-heading"]'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);

  await captureF3Evidence(page, testInfo, 'anonymous-protected-route');
  audit.assertClean();
});
