import { expect, test } from './admin-session.fixture';
import {
  attachStateScreenshot,
  chooseAuthority,
  chooseMutation,
  chooseStaffRole,
  deactivateAccount,
  grantAuthority,
  openApplicantDetail,
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
  test('사용자 목록에서 검색과 페이지네이션을 통과한다', async ({
    adminPage,
  }, testInfo) => {
    // Given: auth seed 사용자가 있는 관리자 전용 사용자 목록. 가입 신청 탭은
    // `/dashboard/applicants`로 분리됐으므로 여기서는 검색·페이지네이션만 본다.
    await adminPage.goto('/admin/access');
    await expect(
      adminPage.getByRole('heading', { name: '사용자 목록' }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('button', { name: '전체 목록', exact: true }),
    ).toHaveCount(0);
    await expect(adminPage.getByRole('button', { name: /요청함/ })).toHaveCount(
      0,
    );
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
    await attachStateScreenshot(adminPage, testInfo, 'list-first-page');
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

  test('STAFF는 사용자 목록과 역할 변경 API를 즉시 거부된다', async ({
    authSeedPage,
  }) => {
    // Given: 아직 회수되지 않은 ACTIVE STAFF 세션.
    const staffPage = await authSeedPage('staff-revocable');

    // When / Then: 명부 화면은 권한 안내를, 명부·역할 변경 API는 403을 반환한다.
    await staffPage.goto('/admin/access');
    await expect(
      staffPage.getByText('접근 권한이 없는 페이지 입니다', {
        exact: true,
      }),
    ).toBeVisible();
    // baseURL(`playwright.config.ts`의 `use.baseURL`)은 page.request에도 적용된다.
    const response = await staffPage.request.get('/api/v1/users/access');
    expect(response.status()).toBe(403);
    const mutationResponse = await requestStaffRoleRevocation(
      staffPage,
      STAFF_APPROVED,
    );
    expect(mutationResponse.status()).toBe(403);
  });

  test('STAFF는 가입 신청을 승인하고 관리자는 감사 로그에서 누가 누구를 본다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    const staffPage = await authSeedPage('staff-revocable');
    await staffPage.goto('/dashboard/applicants');
    await expect(
      staffPage.getByRole('heading', { name: '가입 신청' }),
    ).toBeVisible();
    await expect(
      staffPage.getByRole('link', { name: '합성 대기 사용자', exact: true }),
    ).toBeVisible();
    await expect(
      staffPage.getByRole('link', { name: '가입 신청', exact: true }),
    ).toBeVisible();
    await expect(
      staffPage.getByRole('link', { name: '사용자 목록', exact: true }),
    ).toHaveCount(0);

    await openApplicantDetail(staffPage, STAFF_PENDING, '합성 대기 사용자');
    await chooseMutation(staffPage, '요청 승인');
    await staffPage.getByRole('button', { name: '승인 확정' }).click();
    await expect(
      staffPage
        .getByRole('status')
        .filter({ hasText: '요청 승인 처리를 완료했습니다' }),
    ).toBeVisible();
    await attachStateScreenshot(staffPage, testInfo, 'staff-pending-approved');

    await adminPage.goto('/dashboard');
    await adminPage
      .getByRole('link', { name: '감사 로그', exact: true })
      .click();
    await expect(adminPage).toHaveURL(/\/dashboard\/audit-logs$/);
    await expect(
      adminPage.getByRole('heading', { name: '감사 로그' }),
    ).toBeVisible();
    await adminPage
      .locator('#audit-action')
      .selectOption('STAFF_ROLE_REQUEST_APPROVED');
    await adminPage.getByRole('button', { name: '조회', exact: true }).click();
    const approvedRow = adminPage.getByRole('row').filter({
      hasText: '합성 활성 교직원',
    });
    await expect(
      approvedRow.filter({ hasText: '합성 대기 사용자' }),
    ).toBeVisible();
    await expect(
      approvedRow.getByText('@seed-auth-staff-pending'),
    ).toBeVisible();
    await attachStateScreenshot(adminPage, testInfo, 'audit-log-approver');
  });

  test('학생이 감사 로그 주소로 직접 들어가면 같은 주소에서 접근 거부를 본다', async ({
    authSeedPage,
  }) => {
    // Given: 가입을 마친 학생 세션.
    const studentPage = await authSeedPage('profile-complete');

    // When: 학생이 관리자 전용 감사 로그의 역할 비노출 주소를 직접 연다.
    await studentPage.goto('/dashboard/audit-logs');

    // Then: 다른 화면으로 보내지 않고 같은 주소에서 접근 거부를 보여 준다.
    await expect(studentPage).toHaveURL(/\/dashboard\/audit-logs$/);
    await expect(
      studentPage.getByText('접근 권한이 없는 페이지 입니다', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      studentPage.getByRole('heading', { name: '감사 로그' }),
    ).toHaveCount(0);
  });

  test('교직원 접근을 회수하면 즉시 접근이 막히고, API 회수는 역할 재선택으로 이어진다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    // Given: 회수 전 교직원 접근을 가진 세션은 운영 대시보드에 접근한다.
    const staffPage = await authSeedPage('staff-revocable');
    await staffPage.goto('/dashboard');
    await expect(
      staffPage.getByRole('heading', { name: '운영 대시보드' }),
    ).toBeVisible();

    // When: 관리자가 독립 권한 컨트롤에서 교직원 접근만 회수한다. Task 11이
    // 단일 역할 라디오그룹을 지우고 교직원 접근·관리자 접근을 각각 독립
    // 컨트롤로 쪼갰으므로, 이제 "학생으로 낮춘다"가 아니라 "교직원 접근을
    // 회수한다"가 정본 조작이다. 다이얼로그가 다른 접근 권한은 그대로라고
    // 명시하는지까지 본다 — 독립성이 이 화면의 계약이다.
    await openDetail(adminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    await chooseAuthority(adminPage, '교직원 접근', '해제');
    const revokeDialog = adminPage.getByRole('dialog');
    await expect(revokeDialog).toContainText('교직원 접근 회수');
    await expect(revokeDialog).toContainText(
      'seed-auth-staff-revocable님의 교직원 접근을 회수합니다. 다른 접근 권한은 변경되지 않습니다.',
    );
    await adminPage.getByRole('button', { name: '회수 확정' }).click();
    // 회수 뒤 표시용 역할은 memberKind(학생)만 남아 「학생」으로 접힌다
    // (`authority-label.ts`) — 계정이 사라진 것이 아니라 교직원 접근만 빠졌다.
    await expect(
      adminPage.getByText('학생', { exact: true }).first(),
    ).toBeVisible();
    await attachStateScreenshot(adminPage, testInfo, 'staff-access-revoked');

    // Then: 같은 세션은 교직원 전용 화면에서 즉시 거부된다.
    await staffPage.goto('/programs/new');
    await expect(
      staffPage.getByText('접근 권한이 없는 페이지 입니다', { exact: true }),
    ).toBeVisible();
    await attachStateScreenshot(staffPage, testInfo, 'revoked-denied');

    // And: 학생 정체성은 유지된다 — 내 대시보드는 그대로 열리고 역할 재선택으로
    // 튕기지 않는다. 역할이 null이 되는 아래 API 회수와 갈라지는 지점이다.
    await staffPage.goto('/dashboard');
    await expect(staffPage).not.toHaveURL(/\/onboarding\/role$/);
    await expect(
      staffPage.getByRole('heading', { name: '내 대시보드' }),
    ).toBeVisible();

    // seed-auth-staff-revocable은 deadline-digest.spec.ts가 교직원으로 재사용하는
    // 공유 시드다. 회수한 채로 두면 그 스펙이 운영 대시보드를 못 찾고 깨진다
    // (describe.serial이라 스펙 간 시드 초기화가 없다). adminPage는 여전히 이
    // 사용자의 상세 화면에 있으니 같은 독립 권한 컨트롤로 원상 복구한다 —
    // 삭제된 역할 컨트롤이 아니라 정본 명령으로 되돌려야 뒤 스펙이 격리된다.
    await grantAuthority(adminPage, '교직원 접근');
    await expect(
      adminPage.getByText('교직원', { exact: true }).first(),
    ).toBeVisible();

    // Given: 첫 테스트에서 승인되어 여전히 STAFF인 별도 사용자(seed-auth-
    // staff-pending)로, null 회수·REVOKED 이력은 API 로만 여전히 도달할 수
    // 있는 실제 기능임을 검증한다.
    const revocationResponse = await requestStaffRoleRevocation(
      adminPage,
      STAFF_PENDING,
    );
    expect(revocationResponse.status()).toBe(200);
    expect(
      (await revocationResponse.json()) as { readonly role: unknown },
    ).toMatchObject({ role: null });

    // Then: 회수된 본인 세션은 즉시 역할 재선택으로 튕기고, 별도 재신청
    // 버튼 없이 STAFF를 다시 고를 수 있다.
    const revokedStaffPage = await authSeedPage('staff-pending');
    await revokedStaffPage.goto('/dashboard');
    await expect(revokedStaffPage).toHaveURL(/\/onboarding\/role$/);
    await expect(
      revokedStaffPage.getByRole('heading', { name: '어떤 역할로 쓰시나요' }),
    ).toBeVisible();
    await chooseStaffRole(revokedStaffPage);
    await attachStateScreenshot(
      revokedStaffPage,
      testInfo,
      'null-revoked-reapplied',
    );
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

    // When: 두 번째 관리자가 먼저 같은 STAFF를 API로 null 회수한다 — null
    // 회수는 여전히 REVOKED 이력을 남기는 실제 기능이고, 이제 API 전용
    // 경로다(위 테스트 참고).
    const response = await requestStaffRoleRevocation(
      secondAdminPage,
      STAFF_APPROVED,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()) as { readonly role: unknown }).toMatchObject(
      {
        role: null,
      },
    );

    // Then: 첫 관리자의 화면은 아직 STAFF를 보여주고 있다 — 그 stale 화면에서
    // 계정 상태를 바꾸면 expectedRole이 실제(null)와 어긋나 409이며 화면
    // projection이 즉시 최신화된다. Task 11 이후 교직원·관리자 접근은 CAS가 없는
    // 정본 명령으로 빠졌고, 레거시 CAS 리소스(`expectedRole` 포함)를 타는 화면
    // 경로는 계정 상태 컨트롤만 남았다 — 낙관적 잠금 충돌을 화면에서 만들 수 있는
    // 유일한 지점이라 여기로 옮긴다(`matchesExpectedAccessState`의 레거시 분기).
    expectAdminResourceStatusError(409);
    await deactivateAccount(adminPage);
    await expect(
      adminPage.getByText(
        '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
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
