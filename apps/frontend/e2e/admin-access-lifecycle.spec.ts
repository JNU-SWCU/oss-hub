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
    // Given: auth seed 사용자가 있는 관리자 전용 사용자 목록. 가입 신청 탭은
    // `/dashboard/applicants`로 분리됐으므로 여기서는 검색·페이지네이션만 본다.
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

  test('목록에서 연 상세는 오버레이이고 새로고침하면 표준 상세가 된다', async ({
    adminPage,
  }) => {
    // Given: 관리자 전용 사용자 목록에서 대상 사용자를 검색한다.
    await adminPage.goto('/dashboard/users');
    const search = adminPage.getByLabel('이름 또는 GitHub 닉네임 검색');
    await search.fill('seed-auth-admin-second');
    await adminPage.getByRole('button', { name: '검색', exact: true }).click();
    // 검색은 주소를 바꿔 커밋된다. 그 커밋을 기다리지 않고 행을 누르면 목록이
    // 아직 검색 전 주소에 서 있어, 이 테스트가 검사하려는 「검색 상태를 들고
    // 상세로 간다」가 아예 일어나지 않는다.
    await adminPage.waitForURL(/query=seed-auth-admin-second/);
    await expect(adminPage.locator('table tbody tr')).toHaveCount(1);

    // When: 목록 링크를 소프트 클릭하면 intercepting route가 상세 오버레이를
    // 연다. 주소는 표준 상세 URL이라 공유하거나 새로고침할 수 있어야 한다.
    await adminPage
      .getByRole('link', { name: '합성 두 번째 관리자', exact: true })
      .click();
    // 상세 주소는 목록이 서 있던 질의를 그대로 달고 있다 — 그래야 오버레이
    // 뒤에 깔린 목록이 같은 주소를 다시 읽어도 검색 결과를 잃지 않는다.
    await expect(adminPage).toHaveURL(
      new RegExp(
        `/dashboard/users/${encodeURIComponent(seedId('auth', 'admin-second'))}\\?query=seed-auth-admin-second$`,
      ),
    );
    await expect(adminPage.getByRole('dialog')).toBeVisible();
    // 뒤 목록이 검색 상태 그대로 서 있다(검색어와 결과 한 줄).
    await expect(search).toHaveValue('seed-auth-admin-second');
    await expect(adminPage.locator('table tbody tr')).toHaveCount(1);
    await expect(
      adminPage.getByRole('dialog').getByRole('heading', {
        name: '합성 두 번째 관리자',
        exact: true,
      }),
    ).toBeVisible();

    // Then: 같은 URL을 새로고침하면 오버레이가 아닌 전체 상세 페이지가 열린다.
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
    // Given: 두 번째 PENDING 사용자의 관리자 상세 화면.
    await openDetail(
      adminPage,
      STAFF_PENDING_SECOND,
      '합성 두 번째 대기 사용자',
    );

    // When: 관리자가 합성 사유를 적어 반려한다.
    await chooseMutation(adminPage, '요청 반려');
    await adminPage.getByLabel('반려 사유').fill(REJECTION_REASON);
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
    await staffPage.goto('/dashboard/users');
    await expect(
      staffPage.getByText('접근 권한이 없습니다', {
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
    // Given: 이 공유 시드는 이전 계약에서 학번을 가진 STAFF 역할로 만들어져
    // canonical memberKind가 STUDENT인 채 남을 수 있다. 표시 역할을 해석하지
    // 않고 access projection의 정본 필드만 읽어 관리자 API로 STAFF 전제를 만든다.
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

    // 사번 수정은 관리자의 접근 변경이 아니라 본인 프로필의 저장 동작이다.
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

    // 저장된 staffNumber는 상세를 다시 열어도 canonical projection에서 읽혀야 한다.
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

    // 취소는 정본을 바꾸지 않는다. GET projection을 취소 전후로 비교해
    // 버튼 클릭이 PATCH로 이어지지 않았음을 확인한다.
    const beforeCancelResponse = await getAdminAccessDetail(
      adminPage,
      STAFF_REVOCABLE,
    );
    expect(beforeCancelResponse.status()).toBe(200);
    const beforeCancel = await beforeCancelResponse.json();
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

    // 교직원 → 학생은 기존 학번·학과를 다시 입력하지 않는다. 기존 legacy
    // 학번은 명령에서 생략하고, 확인 다이얼로그는 저장된 값을 증거로 보여 준다.
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

    // deadline-digest.spec.ts가 같은 합성 교직원 세션을 재사용한다. 원래
    // memberKind/studentId/department/접근 플래그를 복구하고, 번호는 원래
    // 값(null)을 다시 넣어 뒤 스펙에 변경을 남기지 않는다. 기존 학번은
    // 복구 명령에서도 생략해 legacy 값을 보존한다.
    if (original.memberKind === 'STUDENT') {
      // member-kind STUDENT keeps the optional staffNumber unless the command
      // explicitly clears it. Cycle through STAFF with the original value so
      // the shared fixture returns to its exact canonical profile, then grant
      // the independent staff access back.
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
    // Given: 첫 관리자가 STAFF 상세의 이전 projection을 보고 있다.
    await openDetail(adminPage, STAFF_APPROVED, '이름 미등록');
    const secondAdminPage = await authSeedPage('admin-second');
    await secondAdminPage.goto('/dashboard/users');

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

  // 회원 유형 전환도 expectedMemberKind + expectedHasStaffAccess를 함께 검사한다.
  // 두 관리자가 같은 STAFF projection에서 출발하면 두 번째의 STUDENT 전환만
  // 성공하고, 첫 번째의 오래된 전환은 409 뒤 최신 projection으로 수렴해야 한다.
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

    // Given: 첫 관리자는 STAFF 상세의 이전 projection을 보고 있다.
    await openDetail(adminPage, STAFF_REVOCABLE, '합성 활성 교직원');
    await expect(adminPage.getByLabel('회원 유형', { exact: true })).toHaveText(
      '교직원',
    );

    // When: 두 번째 관리자가 먼저 같은 계정의 유형을 STUDENT로 전환한다.
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

    // Then: 첫 관리자의 오래된 화면에서 같은 전환을 확정하면 409로 거절되고,
    // 완료 문구 대신 충돌 안내가 서며 유형 컨트롤이 서버 값으로 돌아온다.
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
    // 다시 읽은 이력에는 먼저 전환한 두 번째 관리자의 회수 한 줄이 보인다.
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

    // 공유 시드이므로 원래 정체성과 접근을 다시 켜 둔다. 이 API는 관리자
    // 세션으로만 호출하며 학생/교직원 토큰에서 profile을 쓰지 않는다.
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
