import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { e2eEnvironment } from '../environment';

const PUBLIC_SCREENSHOT_MASK =
  '[data-slot="app-sidebar-foot"], [data-slot="program-scope-sidebar-foot"]';

export async function attachStateScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshotPath = testInfo.outputPath(`public-evidence-${name}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    mask: [page.locator(PUBLIC_SCREENSHOT_MASK)],
    maskColor: '#111827',
  });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

export async function openDetail(
  page: Page,
  userId: string,
  name: string,
): Promise<void> {
  await page.goto(`/admin/access/users/${encodeURIComponent(userId)}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/**
 * 대기 중인 요청 카드의 「승인」/「반려」를 눌러 확인 다이얼로그가 뜨는
 * 지점까지만 진행한다.
 *
 * 예전에는 `접근 변경 작업 선택` 셀렉트 하나에서 작업을 고르고 `실행` 을 눌렀다.
 * #759 가 그 셀렉트를 없애고 `역할`·`계정 상태` 라디오그룹과 승인/반려 버튼으로
 * 쪼갰다. 역할 변경은 이제 이 헬퍼가 아니라 `changeRole` 이 맡는다 — 라디오
 * 버튼 직접 선택 방식이라 "작업 이름 고르기" 추상화에 맞지 않는다.
 */
export async function chooseMutation(
  page: Page,
  optionName: string,
): Promise<void> {
  if (optionName === '요청 승인') {
    await page.getByRole('button', { name: '승인', exact: true }).click();
    return;
  }
  if (optionName === '요청 반려') {
    await page.getByRole('button', { name: '반려', exact: true }).click();
    return;
  }
  throw new Error(`알 수 없는 접근 변경 작업: ${optionName}`);
}

/**
 * 접근 변경 카드의 역할 세그먼트 컨트롤에서 `roleLabel`(학생/교직원/관리자)을
 * 고르고 확인 다이얼로그까지 진행한다.
 *
 * #765 결정 이후 강등·승격 모두 같은 「권한 변경」/「변경 확정」 문구를 쓴다
 * (파괴적 스타일만 다르다) — 직접 강등은 REVOKED 이력을 남기지 않으므로
 * 회수를 자칭하는 별도 문구를 두지 않는다(`admin-access-revocation.ts`).
 * null 로 비우는 진짜 회수(REVOKED 이력 포함)는 이 컨트롤로 갈 수 없고
 * `requestStaffRoleRevocation` 을 통해 API 로만 도달한다.
 */
export async function changeRole(page: Page, roleLabel: string): Promise<void> {
  await page.getByRole('radio', { name: roleLabel, exact: true }).click();
  await page.getByRole('button', { name: '변경 확정', exact: true }).click();
}

export async function chooseStaffRole(page: Page): Promise<void> {
  const staffRole = page.getByRole('radio', { name: /^교직원/ });
  await page.locator('label[data-role="STAFF"]').click();
  await expect(staffRole).toBeChecked();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/pending$/);
  await expect(
    page.getByRole('heading', { name: '교직원 승인을 기다리고 있습니다' }),
  ).toBeVisible();
}

export function requestStaffRoleRevocation(page: Page, targetId: string) {
  return page.request.patch(
    `${e2eEnvironment.baseUrl}/api/v1/users/${encodeURIComponent(targetId)}/access`,
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: e2eEnvironment.baseUrl,
      },
      data: {
        expectedRole: 'STAFF',
        desiredRole: null,
        expectedAccountStatus: 'ACTIVE',
        desiredAccountStatus: 'ACTIVE',
        expectedPendingRequest: null,
      },
    },
  );
}
