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

export async function grantAuthority(
  page: Page,
  authority: '관리자 접근',
): Promise<void> {
  await chooseAuthority(page, authority, '허용');
  await page.getByRole('button', { name: '허용 확정' }).click();
}

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
