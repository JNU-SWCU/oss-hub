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
  await page.goto(`/dashboard/users/${encodeURIComponent(userId)}`);
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
 * 예전에는 `접근 변경 작업 선택` 셀렉트 하나에서 작업을 고르고 `실행`을 눌렀다.
 * 지금은 대기 요청의 승인·반려 버튼만 이 헬퍼가 소유한다. 회원 유형과 관리자
 * 접근·계정 상태는 각각 정본 컨트롤에서 고른 뒤 확인 다이얼로그를 연다.
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

async function chooseRoleOption(
  page: Page,
  label: string,
  optionName: string,
): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true });
  await expect(trigger).toHaveAttribute('role', 'combobox');
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const option = listbox.getByRole('option', {
    name: optionName,
    exact: true,
  });
  await expect(option).toBeVisible();
  await option.click();
}

/**
 * 관리자 접근 값을 골라 확인 다이얼로그를 띄운다(확정은 호출자가 누른다 —
 * 다이얼로그 문구를 먼저 단언하는 흐름에서만 사용한다). 교직원 접근은 이제
 * 회원 유형 전환 명령이 정본이므로 이 브라우저 헬퍼의 범위에서 제외한다.
 */
export async function chooseAuthority(
  page: Page,
  authority: '관리자 접근',
  next: '허용' | '회수',
): Promise<void> {
  await chooseRoleOption(page, authority, next === '허용' ? '허용' : '비허용');
}

export type MemberKind = 'STUDENT' | 'STAFF';

export interface MemberKindChangeInput {
  readonly memberKind: MemberKind;
  readonly expectedMemberKind: MemberKind;
  readonly expectedHasStaffAccess: boolean;
  readonly studentId?: string;
  readonly department?: string;
  readonly staffNumber?: string | null;
}

/**
 * 회원 유형 변경의 관리자 전용 준비·복구 경계. 브라우저 UI 여정의 전제만
 * 만들고 본인(학생/교직원) 세션에서 프로필을 덮어쓰지 않는다.
 */
export function requestMemberKindChange(
  page: Page,
  targetId: string,
  input: MemberKindChangeInput,
) {
  const {
    memberKind,
    expectedMemberKind,
    expectedHasStaffAccess,
    studentId,
    department,
    staffNumber,
  } = input;
  return page.request.patch(
    `${e2eEnvironment.baseUrl}/api/v1/users/${encodeURIComponent(targetId)}/member-kind`,
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: e2eEnvironment.baseUrl,
      },
      data: {
        memberKind,
        expectedMemberKind,
        expectedHasStaffAccess,
        ...(studentId === undefined ? {} : { studentId }),
        ...(department === undefined ? {} : { department }),
        ...(staffNumber === undefined ? {} : { staffNumber }),
      },
    },
  );
}

export function requestStaffAccessGrant(page: Page, targetId: string) {
  return page.request.patch(
    `${e2eEnvironment.baseUrl}/api/v1/users/${encodeURIComponent(targetId)}/staff-access`,
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: e2eEnvironment.baseUrl,
      },
      data: { command: 'GRANT_STAFF_ACCESS' },
    },
  );
}

export function getAdminAccessDetail(page: Page, targetId: string) {
  return page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/${encodeURIComponent(targetId)}/access`,
    { headers: { Origin: e2eEnvironment.baseUrl } },
  );
}

/**
 * 회원 유형 컨트롤에서 다음 정본 유형을 고른다. 확정 버튼과 프로필 필드는
 * 시나리오가 독립적으로 단언할 수 있게 여기서 누르지 않는다.
 */
export async function chooseMemberKind(
  page: Page,
  next: MemberKind,
): Promise<void> {
  await chooseRoleOption(
    page,
    '회원 유형',
    next === 'STUDENT' ? '학생' : '교직원',
  );
}

/**
 * 접근 변경 카드의 「계정 상태」 컨트롤 — Task 11 이후도 여전히 레거시 CAS
 * 리소스(`expectedRole` 포함)를 통해 쓰는 유일한 화면 경로라, 낙관적 잠금
 * 충돌(409 `ROL_013`)을 화면에서 만들어 볼 수 있는 지점이다. 이 묶음도 같은
 * 드롭다운 규격이라 「비활성화」는 곧 「비활성」 값을 고르는 일이다.
 */
export async function chooseAccountStatus(
  page: Page,
  action: '재활성화' | '비활성화',
): Promise<void> {
  await chooseRoleOption(
    page,
    '계정 상태',
    action === '재활성화' ? '활성' : '비활성',
  );
}

/**
 * 관리자 접근 허용 → 「허용 확정」까지 한 번에 누르는 기계적 조작 묶음.
 * 다이얼로그 문구를 단언할 일이 없는 지점에서만 쓴다.
 */
export async function grantAuthority(
  page: Page,
  authority: '관리자 접근',
): Promise<void> {
  await chooseAuthority(page, authority, '허용');
  await page.getByRole('button', { name: '허용 확정' }).click();
}

/** 비활성화 → 「비활성화 확정」까지의 기계적 조작 묶음. */
export async function deactivateAccount(page: Page): Promise<void> {
  await chooseAccountStatus(page, '비활성화');
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
