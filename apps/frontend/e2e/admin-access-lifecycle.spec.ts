import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import {
  attachStateScreenshot,
  chooseMutation,
  chooseStaffRole,
  openDetail,
  requestStaffRoleRevocation,
} from './support/admin-access-actions';
import { seedId } from './support/session-cookie';

const STAFF_PENDING = seedId('auth', 'staff-pending');
const STAFF_PENDING_SECOND = seedId('auth', 'staff-pending-second');
const STAFF_APPROVED = seedId('auth', 'staff-approved');
const STAFF_REVOCABLE = seedId('auth', 'staff-revocable');
const REJECTION_REASON =
  '합성 E2E 반려 사유 — 담당 프로그램 소속을 다시 확인해 주세요.';

test.describe.serial('관리자 접근 권한 lifecycle', () => {
  test('목록에서 PENDING 교직원 요청을 찾아 승인한다', async ({
    adminPage,
  }, testInfo) => {
    // Given: auth seed의 두 PENDING 요청이 있는 관리자 접근 목록.
    await adminPage.goto('/admin/access');
    await expect(
      adminPage.getByRole('heading', { name: '접근 목록' }),
    ).toBeVisible();
    const allTab = adminPage.getByRole('button', {
      name: '전체 목록',
      exact: true,
    });
    const pendingTab = adminPage.getByRole('button', { name: /요청함 \(2\)/ });
    await expect(allTab).toHaveAttribute('aria-pressed', 'true');
    await pendingTab.click();
    await expect(adminPage).toHaveURL(/pendingRequest=PENDING/);
    await expect(pendingTab).toHaveAttribute('aria-pressed', 'true');
    await expect(
      adminPage.getByRole('link', { name: '합성 대기 사용자', exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('link', {
        name: '합성 두 번째 대기 사용자',
        exact: true,
      }),
    ).toBeVisible();
    await allTab.click();
    await expect(allTab).toHaveAttribute('aria-pressed', 'true');
    await expect(
      adminPage.getByText(/1 \/ \d+ 페이지 \(총 \d+명\)/),
    ).toBeVisible();

    // When: GitHub ID 검색과 빈 결과/초기화까지 실제 목록 제어를 통과한다.
    const search = adminPage.getByLabel('이름 또는 GitHub 닉네임 검색');
    await search.fill('seed-auth-admin-second');
    await adminPage.getByRole('button', { name: '검색', exact: true }).click();
    await expect(
      adminPage.getByText('@seed-auth-admin-second', { exact: true }),
    ).toBeVisible();
    await search.fill('존재하지-않는-합성-사용자');
    await adminPage.getByRole('button', { name: '검색', exact: true }).click();
    await expect(adminPage.getByText('검색 결과가 없습니다')).toBeVisible();
    await adminPage.getByRole('button', { name: '필터 초기화' }).click();

    const nextPage = adminPage.getByRole('button', { name: '다음' });
    await expect(nextPage).toBeEnabled();
    // Next.js 개발 오버레이 토글이 우하단 버튼의 포인터를 가릴 수 있다. 실제
    // 키보드 사용자 경로로 이동해 접근성과 페이지 전이를 함께 검증한다.
    await nextPage.press('Enter');
    await expect(adminPage).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect(
      adminPage.getByText(/2 \/ \d+ 페이지 \(총 \d+명\)/),
    ).toBeVisible();
    await expect(adminPage.getByRole('button', { name: '이전' })).toBeEnabled();
    await attachStateScreenshot(adminPage, testInfo, 'list-second-page');

    await adminPage.getByRole('button', { name: '이전' }).click();

    // Then: PENDING 요청 승인 후 STAFF와 승인 이력이 함께 보인다.
    await openDetail(adminPage, STAFF_PENDING, '합성 대기 사용자');
    await chooseMutation(adminPage, '요청 승인');
    await adminPage.getByRole('button', { name: '승인 확정' }).click();
    await expect(
      adminPage.getByText('교직원', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      adminPage
        .getByRole('status')
        .filter({ hasText: '요청 승인 처리를 완료했습니다' }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('heading', { name: '요청 이력' }).locator('..'),
    ).toContainText('승인');
    await attachStateScreenshot(adminPage, testInfo, 'pending-approved');
  });

  test('PENDING 요청을 반려한 뒤 사용자가 교직원으로 재신청한다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    // Given: 두 번째 PENDING 사용자의 관리자 상세 화면.
    await openDetail(
      adminPage,
      STAFF_PENDING_SECOND,
      '합성 두 번째 대기 사용자',
    );

    // When: 관리자가 합성 사유를 적어 반려한다.
    await chooseMutation(adminPage, '요청 반려');
    await adminPage.getByLabel('거절 사유').fill(REJECTION_REASON);
    await adminPage.getByRole('button', { name: '반려 확정' }).click();
    await expect(
      adminPage.getByRole('heading', { name: '요청 이력' }).locator('..'),
    ).toContainText(REJECTION_REASON);
    await attachStateScreenshot(adminPage, testInfo, 'pending-rejected');

    // Then: 사용자는 반려 사유를 읽고 별도 재신청 버튼 없이 STAFF를 다시 고른다.
    const applicantPage = await authSeedPage('staff-pending-second');
    await applicantPage.goto('/dashboard');
    await expect(applicantPage).toHaveURL(/\/onboarding\/role$/);
    await expect(
      applicantPage.getByText('교직원 요청이 반려되었습니다'),
    ).toBeVisible();
    await expect(applicantPage.getByText(REJECTION_REASON)).toBeVisible();
    await expect(
      applicantPage.getByRole('button', { name: '다시 승인 요청하기' }),
    ).toHaveCount(0);
    await chooseStaffRole(applicantPage);
    await attachStateScreenshot(applicantPage, testInfo, 'rejected-reapplied');
  });

  test('STAFF는 관리자 화면과 읽기·쓰기 API 모두 즉시 거부된다', async ({
    authSeedPage,
  }) => {
    // Given: 아직 회수되지 않은 ACTIVE STAFF 세션.
    const staffPage = await authSeedPage('staff-revocable');

    // When / Then: 관리자 화면은 권한 안내를, API는 403을 반환한다.
    await staffPage.goto('/admin/access');
    await expect(
      staffPage.getByText('접근 권한이 없는 페이지 입니다', {
        exact: true,
      }),
    ).toBeVisible();
    const response = await staffPage.request.get(
      `${e2eEnvironment.baseUrl}/api/v1/users/access`,
    );
    expect(response.status()).toBe(403);
    const mutationResponse = await requestStaffRoleRevocation(
      staffPage,
      STAFF_APPROVED,
    );
    expect(mutationResponse.status()).toBe(403);
  });

  test('APPROVED STAFF를 회수하면 역할 재선택과 재신청으로 이어진다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    // Given: 회수 전 STAFF 세션은 운영 대시보드에 접근한다.
    const staffPage = await authSeedPage('staff-revocable');
    await staffPage.goto('/staff/dashboard');
    await expect(
      staffPage.getByRole('heading', { name: '운영 대시보드' }),
    ).toBeVisible();

    // When: 관리자가 STAFF 역할을 null로 회수한다.
    await openDetail(adminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    await chooseMutation(adminPage, '권한 회수 (교직원 권한 제거)');
    const revokeDialog = adminPage.getByRole('dialog');
    await expect(revokeDialog).toContainText('역할을 비웁니다');
    await expect(revokeDialog).toContainText(
      '학생 또는 교직원 역할을 다시 선택할 수 있습니다.',
    );
    await expect(revokeDialog).not.toContainText('학생으로 강등');
    await adminPage.getByRole('button', { name: '회수 확정' }).click();
    await expect(
      adminPage.getByText('미지정', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('heading', { name: '요청 이력' }).locator('..'),
    ).toContainText('회수');
    await attachStateScreenshot(adminPage, testInfo, 'staff-revoked');

    // Then: 같은 STAFF 세션도 보호 화면에 다시 들어갈 수 없고 역할 선택으로 간다.
    await staffPage.goto('/staff/dashboard');
    await expect(staffPage).toHaveURL(/\/onboarding\/role$/);
    await expect(
      staffPage.getByRole('heading', { name: '어떤 역할로 쓰시나요' }),
    ).toBeVisible();
    await chooseStaffRole(staffPage);
    await attachStateScreenshot(staffPage, testInfo, 'revoked-reapplied');
  });

  test('두 관리자의 오래된 화면은 409 뒤 최신 역할로 수렴한다', async ({
    adminPage,
    authSeedPage,
    expectAdminResourceStatusError,
  }, testInfo) => {
    // Given: 첫 관리자가 STAFF 상세의 이전 projection을 보고 있다.
    await openDetail(adminPage, STAFF_APPROVED, '이름 미등록');
    const secondAdminPage = await authSeedPage('admin-second');
    await secondAdminPage.goto('/admin/access');

    // When: 두 번째 관리자가 먼저 같은 STAFF를 API로 회수한다.
    const response = await secondAdminPage.request.patch(
      `${e2eEnvironment.baseUrl}/api/v1/users/${encodeURIComponent(STAFF_APPROVED)}/access`,
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
    expect(response.status()).toBe(200);
    expect((await response.json()) as { readonly role: unknown }).toMatchObject(
      {
        role: null,
      },
    );

    // Then: 첫 관리자의 stale PATCH는 409이며 화면 projection이 즉시 최신화된다.
    expectAdminResourceStatusError(409);
    await chooseMutation(adminPage, '권한 회수 (교직원 권한 제거)');
    await adminPage.getByRole('button', { name: '회수 확정' }).click();
    await expect(
      adminPage.getByText(
        '다른 관리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
      ),
    ).toBeVisible();
    await expect(
      adminPage.getByText('미지정', { exact: true }).first(),
    ).toBeVisible();
    await attachStateScreenshot(
      adminPage,
      testInfo,
      'stale-conflict-converged',
    );

    await adminPage.reload();
    const requestHistory = adminPage
      .getByRole('heading', { name: '요청 이력' })
      .locator('..');
    await expect(requestHistory).toContainText('회수');
    await expect(requestHistory).toContainText('seed-auth-admin-second');
  });
});
