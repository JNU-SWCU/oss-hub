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
 * 접근 변경을 시작한다 — 확인 다이얼로그가 뜨는 지점까지만 진행한다.
 *
 * 예전에는 `접근 변경 작업 선택` 셀렉트 하나에서 작업을 고르고 `실행` 을 눌렀다.
 * #759 가 그 셀렉트를 없애고 `역할`·`계정 상태` 라디오그룹과 승인/반려 버튼으로
 * 쪼갰는데 이 헬퍼가 따라가지 않아 main 의 e2e 가 계속 빨간불이었다.
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
  if (optionName.startsWith('권한 회수')) {
    // 새 UI 에는 `STAFF → null` 로 가는 컨트롤이 없다(`ROLE_ORDER` 는
    // STUDENT·STAFF·ADMIN 뿐이고 `actionForRole` 에 null 갈래가 없다).
    // 백엔드는 그 전이에서만 `REVOKED` 이력을 남기므로(`admin-access-transition-table`),
    // `학생` 을 고르는 것으로 대신하면 회수라는 사실이 기록되지 않는다.
    // 그 이력은 #184 안내와 로그인 시드 가드가 읽는 값이라 대체가 성립하지 않는다.
    throw new Error(
      '권한 회수 경로가 UI 에 없다 — #759 가 STAFF → null 컨트롤을 제거했다. ' +
        '학생 전환으로 대체하면 REVOKED 이력이 남지 않아 같은 시나리오가 아니다.',
    );
  }
  throw new Error(`알 수 없는 접근 변경 작업: ${optionName}`);
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
