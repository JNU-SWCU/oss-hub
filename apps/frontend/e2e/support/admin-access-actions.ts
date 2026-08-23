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

export async function openApplicantDetail(
  page: Page,
  userId: string,
  name: string,
): Promise<void> {
  await page.goto(`/dashboard/applicants/users/${encodeURIComponent(userId)}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/**
 * 대기 중인 요청 카드의 「승인」/「반려」를 눌러 확인 다이얼로그가 뜨는
 * 지점까지만 진행한다.
 *
 * 예전에는 `접근 변경 작업 선택` 셀렉트 하나에서 작업을 고르고 `실행` 을 눌렀다.
 * #759 가 그 셀렉트를 없애고 라디오그룹과 승인/반려 버튼으로 쪼갰으며, Task 11이
 * 다시 역할 라디오그룹을 지우고 교직원·관리자 접근을 독립 컨트롤로 나눠놓았다.
 * 그쪽은 이 헬퍼가 아니라 `chooseAuthority`·`chooseAccountStatus` 가 맡는다 —
 * 라디오 버튼 직접 선택 방식이라 "작업 이름 고르기" 추상화에 맞지 않는다.
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
 * 접근 변경 카드의 독립 권한 세그먼트 컨트롤에서 교직원·관리자 접근을
 * 허용/해제하고 확인 다이얼로그를 띄운다(확정은 호출자가 누른다 — 다이얼로그
 * 문구를 먼저 단언하는 것이 이 흐름의 핵심이다).
 *
 * Task 11이 단일 「역할」 라디오그룹을 지우고 교직원 접근·관리자 접근을
 * 각각 독립 컨트롤로 쪼개다 — 한 칸에 접힌 표시용 역할(`authorityLabel`)은
 * 이제 배지로만 남고 쓰기는 `hasStaffAccess`·`hasAdminAccess`를 각각 바꾸는
 * 두 명령이 맡는다. 각 버튼의 접근성 이름은 sr-only 라벨(「교직원 접근」)과
 * 보이는 텍스트(「허용」/「해제」)가 합쳐진 값이라, 그룹을 먼저 잡고 그 안에서
 * 버튼을 고른다.
 */
export async function chooseAuthority(
  page: Page,
  authority: '교직원 접근' | '관리자 접근',
  next: '허용' | '해제',
): Promise<void> {
  await page
    .getByRole('radiogroup', { name: authority })
    .getByRole('radio', { name: new RegExp(`${next}$`) })
    .click();
}

/**
 * 접근 변경 카드의 「계정 상태」 세그먼트 컨트롤 — Task 11 이후도 여전히
 * 레거시 CAS 리소스(`expectedRole` 포함)를 통해 쓰는 유일한 화면 경로라,
 * 낙관적 잠금 충돌(409 `ROL_013`)을 화면에서 만들어 볼 수 있는 지점이다.
 */
export async function chooseAccountStatus(
  page: Page,
  statusLabel: '활성' | '비활성',
): Promise<void> {
  await page
    .getByRole('radiogroup', { name: '계정 상태' })
    .getByRole('radio', { name: statusLabel, exact: true })
    .click();
}

/**
 * 허용 → 「허용 확정」까지 한 번에 누르는 기계적 조작 묶음. 다이얼로그 문구를
 * 단언할 일이 없는 지점(예: 공유 시드 원상 복구)에서만 쓴다 — 선택과 확정
 * 사이에 단언이 끼는 흐름은 `chooseAuthority`를 직접 쓰고 확정을 따로 누른다.
 */
export async function grantAuthority(
  page: Page,
  authority: '교직원 접근' | '관리자 접근',
): Promise<void> {
  await chooseAuthority(page, authority, '허용');
  await page.getByRole('button', { name: '허용 확정' }).click();
}

/** 비활성 → 「비활성화 확정」까지의 기계적 조작 묶음. */
export async function deactivateAccount(page: Page): Promise<void> {
  await chooseAccountStatus(page, '비활성');
  await page.getByRole('button', { name: '비활성화 확정' }).click();
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
