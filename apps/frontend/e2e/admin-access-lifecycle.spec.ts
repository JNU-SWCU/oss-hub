import { expect, test } from './admin-session.fixture';
import {
  attachStateScreenshot,
  chooseMemberKind,
  chooseMutation,
  chooseStaffRole,
  deactivateAccount,
  getAdminAccessDetail,
  openApplicantDetail,
  openDetail,
  requestMemberKindChange,
  requestStaffAccessGrant,
  requestStaffRoleRevocation,
} from './support/admin-access-actions';
import { ADMIN_SEED_USER_ID, seedId } from './support/session-cookie';

const STAFF_PENDING = seedId('auth', 'staff-pending');
const STAFF_PENDING_SECOND = seedId('auth', 'staff-pending-second');
const STAFF_APPROVED = seedId('auth', 'staff-approved');
const STAFF_REVOCABLE = seedId('auth', 'staff-revocable');
const REJECTION_REASON =
  '합성 E2E 반려 사유 — 담당 프로그램 소속을 다시 확인해 주세요.';

test.describe.serial('관리자 접근 권한 lifecycle', () => {
  test('본인 계정의 제한은 선택지를 막고 hover와 포커스로만 안내한다', async ({
    adminPage,
  }) => {
    await adminPage.goto(
      `/dashboard/users/${encodeURIComponent(ADMIN_SEED_USER_ID)}`,
    );
    const adminAccess = adminPage.locator('#admin-admin-access-control');
    await expect(adminAccess).toHaveText('허용');
    const reason = '자기 계정의 관리자 접근은 회수할 수 없습니다.';
    await expect(adminPage.getByText(reason, { exact: true })).toHaveCount(0);

    await adminAccess.hover();
    await expect(adminPage.getByRole('tooltip')).toHaveText(reason);
    await adminPage.mouse.move(0, 0, { steps: 5 });
    await expect(adminPage.getByRole('tooltip')).toHaveCount(0);
    await adminAccess.focus();
    await expect(adminPage.getByRole('tooltip')).toHaveText(reason);
    await adminAccess.press('Escape');
    await expect(adminPage.getByRole('tooltip')).toHaveCount(0);

    const writes: string[] = [];
    adminPage.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/users/')) {
        writes.push(request.url());
      }
    });
    await adminAccess.click();
    await expect(
      adminPage.getByRole('option', { name: '비허용', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await adminPage.keyboard.press('ArrowUp');
    await adminPage.keyboard.press('Enter');
    await expect(adminAccess).toHaveText('허용');
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('사용자 목록에서 검색과 페이지네이션을 통과한다', async ({
    adminPage,
  }, testInfo) => {
    await adminPage.goto('/dashboard/users');
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

  test('목록에서 연 상세는 오버레이이고 새로고침하면 표준 상세가 된다', async ({
    adminPage,
  }) => {
    await adminPage.goto('/dashboard/users');
    const search = adminPage.getByLabel('이름 또는 GitHub 닉네임 검색');
    await search.fill('seed-auth-admin-second');
    await adminPage.getByRole('button', { name: '검색', exact: true }).click();

    await adminPage.waitForURL(/query=seed-auth-admin-second/);
    await expect(adminPage.locator('table tbody tr')).toHaveCount(1);

    await adminPage
      .getByRole('link', { name: '합성 두 번째 관리자', exact: true })
      .click();

    await expect(adminPage).toHaveURL(
      new RegExp(
        `/dashboard/users/${encodeURIComponent(seedId('auth', 'admin-second'))}\\?query=seed-auth-admin-second$`,
      ),
    );
    await expect(adminPage.getByRole('dialog')).toBeVisible();

    await expect(search).toHaveValue('seed-auth-admin-second');
    await expect(adminPage.locator('table tbody tr')).toHaveCount(1);
    await expect(
      adminPage.getByRole('dialog').getByRole('heading', {
        name: '합성 두 번째 관리자',
        exact: true,
      }),
    ).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      adminPage.getByRole('heading', {
        name: '합성 두 번째 관리자',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('PENDING 요청을 반려한 뒤 사용자가 교직원으로 재신청한다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    await openDetail(
      adminPage,
      STAFF_PENDING_SECOND,
      '합성 두 번째 대기 사용자',
    );

    await chooseMutation(adminPage, '요청 반려');
    await adminPage.getByLabel('반려 사유').fill(REJECTION_REASON);
    await adminPage.getByRole('button', { name: '반려 확정' }).click();
    await expect(
      adminPage.getByRole('heading', { name: '요청 이력' }).locator('..'),
    ).toContainText(REJECTION_REASON);
    await attachStateScreenshot(adminPage, testInfo, 'pending-rejected');

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
    const staffPage = await authSeedPage('staff-revocable');

    await staffPage.goto('/dashboard/users');
    await expect(
      staffPage.getByText('접근 권한이 없습니다', {
        exact: true,
      }),
    ).toBeVisible();

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
    const studentPage = await authSeedPage('profile-complete');

    await studentPage.goto('/dashboard/audit-logs');

    await expect(studentPage).toHaveURL(/\/dashboard\/audit-logs$/);
    await expect(
      studentPage.getByText('접근 권한이 없습니다', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      studentPage.getByRole('heading', { name: '감사 로그' }),
    ).toHaveCount(0);
  });

  test('관리자가 회원 유형을 전환하면 교직원 번호·학번을 보존하고 취소는 쓰지 않는다', async ({
    adminPage,
    authSeedPage,
  }, testInfo) => {
    const originalResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(originalResponse.status()).toBe(200);
    const original = (await originalResponse.json()) as {
      readonly memberKind: 'STUDENT' | 'STAFF';
      readonly hasStaffAccess: boolean;
      readonly profile: {
        readonly studentId: string | null;
        readonly department: string | null;
        readonly staffNumber: string | null;
      };
    };
    expect(['STUDENT', 'STAFF']).toContain(original.memberKind);
    expect(original.hasStaffAccess).toBe(true);
    if (original.memberKind === 'STUDENT') {
      const preparation = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: true,
          staffNumber: null,
        },
      );
      expect(preparation.status()).toBe(200);
    }
    const preparedResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(preparedResponse.status()).toBe(200);
    const prepared = (await preparedResponse.json()) as {
      readonly memberKind: 'STUDENT' | 'STAFF';
      readonly hasStaffAccess: boolean;
      readonly profile: {
        readonly studentId: string | null;
        readonly department: string | null;
        readonly staffNumber: string | null;
      };
    };
    expect(prepared).toMatchObject({
      memberKind: 'STAFF',
      hasStaffAccess: true,
    });
    expect(prepared.profile.studentId).toBe(original.profile.studentId);
    expect(prepared.profile.department).toBe(original.profile.department);

    await openDetail(adminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    const memberKind = adminPage.getByLabel('회원 유형', { exact: true });
    await expect(memberKind).toHaveText('교직원');

    await expect(
      adminPage.getByRole('button', { name: '교직원 정보 수정', exact: true }),
    ).toHaveCount(0);
    const staffPage = await authSeedPage('staff-revocable');
    await staffPage.goto('/settings');
    const ownStaffNumber = staffPage.getByLabel('교직원 번호 (선택)', {
      exact: true,
    });
    await expect(ownStaffNumber).toBeVisible();
    const maximumLengthStaffNumber = '𐐀'.repeat(100);
    const notificationEmail = staffPage.getByLabel('수신 이메일', {
      exact: true,
    });
    if (
      (await notificationEmail.count()) > 0 &&
      (await notificationEmail.inputValue()) === ''
    ) {
      await notificationEmail.fill('staff-profile@example.test');
    }
    async function saveOwnStaffNumber(value: string) {
      await ownStaffNumber.fill(value);
      await expect(ownStaffNumber).toHaveValue(value);
      const response = staffPage.waitForResponse(
        (candidate) =>
          candidate.url().endsWith('/api/v1/users/me/profile') &&
          candidate.request().method() === 'PATCH',
      );
      const save = staffPage.getByRole('button', { name: '저장', exact: true });
      await save.click();
      expect((await response).status()).toBe(200);
      await expect(save).toBeEnabled();
      await staffPage.reload();
      await expect(ownStaffNumber).toHaveValue(value.trim().normalize('NFC'));
    }
    await saveOwnStaffNumber(maximumLengthStaffNumber);
    await saveOwnStaffNumber('');
    await saveOwnStaffNumber('E2E-STAFF-42');

    await adminPage.reload();
    await expect(memberKind).toHaveText('교직원');
    await expect(
      adminPage.getByText('E2E-STAFF-42', { exact: true }),
    ).toBeVisible();
    const savedStaffResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(savedStaffResponse.status()).toBe(200);
    expect(
      (await savedStaffResponse.json()) as {
        readonly profile: { readonly staffNumber: string | null };
      },
    ).toMatchObject({ profile: { staffNumber: 'E2E-STAFF-42' } });

    const beforeCancelResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(beforeCancelResponse.status()).toBe(200);
    const beforeCancel: unknown = await beforeCancelResponse.json();
    await chooseMemberKind(adminPage, 'STUDENT');
    const cancelledDialog = adminPage.getByRole('dialog');
    await expect(cancelledDialog).toContainText('학생으로 변경');
    await cancelledDialog
      .getByRole('button', { name: '취소', exact: true })
      .click();
    await expect(cancelledDialog).toHaveCount(0);
    await expect(memberKind).toBeFocused();
    const afterCancelResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(afterCancelResponse.status()).toBe(200);
    expect(await afterCancelResponse.json()).toEqual(beforeCancel);

    expect(prepared.profile.studentId).not.toBeNull();
    expect(prepared.profile.department).not.toBeNull();
    const preservedStudentId = prepared.profile.studentId as string;
    const preservedDepartment = prepared.profile.department as string;
    await chooseMemberKind(adminPage, 'STUDENT');
    const studentDialog = adminPage.getByRole('dialog');
    await expect(studentDialog.getByLabel('학번', { exact: true })).toHaveCount(
      0,
    );
    await expect(studentDialog.getByLabel('학과', { exact: true })).toHaveCount(
      0,
    );
    await expect(studentDialog).toContainText(preservedStudentId);
    await expect(studentDialog).toContainText(preservedDepartment);
    await studentDialog
      .getByRole('button', { name: '변경', exact: true })
      .click();
    await expect(memberKind).toHaveText('학생');
    await expect(
      adminPage.getByText(preservedStudentId, { exact: true }),
    ).toBeVisible();
    await adminPage.reload();
    await expect(memberKind).toHaveText('학생');
    await expect(
      adminPage.getByText(preservedStudentId, { exact: true }),
    ).toBeVisible();
    const savedStudentResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(savedStudentResponse.status()).toBe(200);
    expect(await savedStudentResponse.json()).toMatchObject({
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      profile: {
        studentId: preservedStudentId,
        department: preservedDepartment,
      },
    });
    await attachStateScreenshot(adminPage, testInfo, 'member-kind-roundtrip');

    if (original.memberKind === 'STUDENT') {
      const restoredStaff = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: false,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredStaff.status()).toBe(200);
      expect(original.profile.studentId).not.toBeNull();
      expect(original.profile.department).not.toBeNull();
      const restoredStudent = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STUDENT',
          expectedMemberKind: 'STAFF',
          expectedHasStaffAccess: true,
          department: original.profile.department as string,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredStudent.status()).toBe(200);
      if (original.hasStaffAccess) {
        const restoredAccess = await requestStaffAccessGrant(
          adminPage,
          STAFF_REVOCABLE,
        );
        expect(restoredAccess.status()).toBe(200);
      }
    } else {
      const restoredKind = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: false,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredKind.status()).toBe(200);
    }
    const restoredResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(restoredResponse.status()).toBe(200);
    expect(await restoredResponse.json()).toMatchObject({
      memberKind: original.memberKind,
      hasStaffAccess: original.hasStaffAccess,
      profile: {
        studentId: original.profile.studentId,
        department: original.profile.department,
        staffNumber: original.profile.staffNumber,
      },
    });
  });

  test('두 관리자의 오래된 화면은 409 뒤 최신 역할로 수렴한다', async ({
    adminPage,
    authSeedPage,
    expectAdminResourceStatusError,
  }, testInfo) => {
    await openDetail(adminPage, STAFF_APPROVED, '이름 미등록');
    const secondAdminPage = await authSeedPage('admin-second');
    await secondAdminPage.goto('/dashboard/users');

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

  test('회원 유형의 오래된 화면은 409 뒤 최신 유형과 회수 이력으로 수렴한다', async ({
    adminPage,
    authSeedPage,
    expectAdminResourceStatusError,
  }, testInfo) => {
    const originalResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(originalResponse.status()).toBe(200);
    const original = (await originalResponse.json()) as {
      readonly memberKind: 'STUDENT' | 'STAFF';
      readonly hasStaffAccess: boolean;
      readonly profile: {
        readonly studentId: string | null;
        readonly department: string | null;
        readonly staffNumber: string | null;
      };
    };
    expect(original.hasStaffAccess).toBe(true);
    if (original.memberKind === 'STUDENT') {
      const preparation = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: true,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(preparation.status()).toBe(200);
    }

    const staleStudentId = original.profile.studentId;
    const staleDepartment = original.profile.department;
    if (staleStudentId === null || staleDepartment === null) {
      throw new TypeError(
        '이 합성 시나리오는 저장된 학생 학번과 학과가 필요합니다.',
      );
    }

    await openDetail(adminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    await expect(adminPage.getByLabel('회원 유형', { exact: true })).toHaveText(
      '교직원',
    );

    const secondAdminPage = await authSeedPage('admin-second');
    await openDetail(secondAdminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    await chooseMemberKind(secondAdminPage, 'STUDENT');
    const secondDialog = secondAdminPage.getByRole('dialog');
    await expect(secondDialog.getByLabel('학번', { exact: true })).toHaveCount(
      0,
    );
    await expect(secondDialog.getByLabel('학과', { exact: true })).toHaveCount(
      0,
    );
    await expect(secondDialog).toContainText(staleStudentId);
    await expect(secondDialog).toContainText(staleDepartment);
    await secondDialog
      .getByRole('button', { name: '변경', exact: true })
      .click();
    await expect(
      secondAdminPage.getByLabel('회원 유형', { exact: true }),
    ).toHaveText('학생');

    expectAdminResourceStatusError(409);
    await chooseMemberKind(adminPage, 'STUDENT');
    const staleDialog = adminPage.getByRole('dialog');
    await expect(staleDialog.getByLabel('학번', { exact: true })).toHaveCount(
      0,
    );
    await expect(staleDialog.getByLabel('학과', { exact: true })).toHaveCount(
      0,
    );
    await expect(staleDialog).toContainText(staleStudentId);
    await expect(staleDialog).toContainText(staleDepartment);
    await staleDialog
      .getByRole('button', { name: '변경', exact: true })
      .click();
    await expect(
      adminPage.getByText(
        '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
      ),
    ).toBeVisible();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    await expect(adminPage.getByText(/처리를 완료했습니다/)).toHaveCount(0);
    await expect(adminPage.getByLabel('회원 유형', { exact: true })).toHaveText(
      '학생',
    );

    const requestHistory = adminPage
      .getByRole('heading', { name: '요청 이력' })
      .locator('..');
    await expect(requestHistory).toContainText('회수');
    await expect(requestHistory).toContainText('seed-auth-admin-second');
    await attachStateScreenshot(
      adminPage,
      testInfo,
      'stale-member-kind-conflict',
    );

    if (original.memberKind === 'STUDENT') {
      const restoredStaff = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: false,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredStaff.status()).toBe(200);
      expect(original.profile.studentId).not.toBeNull();
      expect(original.profile.department).not.toBeNull();
      const restoredStudent = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STUDENT',
          expectedMemberKind: 'STAFF',
          expectedHasStaffAccess: true,
          department: original.profile.department as string,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredStudent.status()).toBe(200);
      if (original.hasStaffAccess) {
        const restoredAccess = await requestStaffAccessGrant(
          adminPage,
          STAFF_REVOCABLE,
        );
        expect(restoredAccess.status()).toBe(200);
      }
    } else {
      const restoredKind = await requestMemberKindChange(
        adminPage,
        STAFF_REVOCABLE,
        {
          memberKind: 'STAFF',
          expectedMemberKind: 'STUDENT',
          expectedHasStaffAccess: false,
          staffNumber: original.profile.staffNumber,
        },
      );
      expect(restoredKind.status()).toBe(200);
    }
    const restoredResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(restoredResponse.status()).toBe(200);
    expect(await restoredResponse.json()).toMatchObject({
      memberKind: original.memberKind,
      hasStaffAccess: original.hasStaffAccess,
      profile: {
        studentId: original.profile.studentId,
        department: original.profile.department,
        staffNumber: original.profile.staffNumber,
      },
    });
  });
});
