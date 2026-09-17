import { expect, test } from './admin-session.fixture';
import { capture, captureRegion } from './support/repository-relink-evidence';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

/**
 * 교직원이 팀 상세에서 팀 이름을 고친다(`PATCH /programs/:programId/teams/:teamId`).
 *
 * 이 회귀는 **실제 격리 백엔드와 DB**를 쓴다 — 이름이 화면에서만 바뀌고 저장되지
 * 않는 회귀는 UI만 가로챈 테스트로는 잡히지 않기 때문이다. 그래서 저장 뒤 새로고침해
 * 서버가 준 값으로 다시 읽는 데까지 확인한다.
 */
const RENAMED = 'e2e:renamed-team';

test('교직원이 팀 이름을 고치면 새로고침 뒤에도 남는다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  // Given: 실제 신청 한 건을 만들어 팀을 세운다.
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  await expectApiStatus(
    await control.request.post(
      `${PROGRAM_AUTHORING_CONTROL_PATH}/applications`,
      { data: { mode: 'NEW' } },
    ),
    201,
  );

  const staff = await programAuthoringActorPage('staff');
  await staff.goto(`/programs/${encodeURIComponent(programId)}/teams`);

  // 신청자 목록의 팀명이 팀 상세로 가는 링크다 — 오타를 알아보는 자리에서 고치는
  // 자리로 이어지는지 함께 확인한다.
  await staff.goto(`/programs/${encodeURIComponent(programId)}/applicants`);
  const applicantsTable = staff.getByRole('table');
  await expect(applicantsTable).toBeVisible();
  await captureRegion(
    applicantsTable,
    testInfo,
    'after-element-applicants-table',
  );
  const teamCellLink = applicantsTable.locator('a[href*="/teams/"]').first();
  await expect(teamCellLink).toBeVisible();
  const originalName = (await teamCellLink.innerText()).trim();
  // 셀은 「팀명 (N명)」이다 — 접근 가능한 이름과 입력칸 값은 팀명만 쓴다.
  const teamNameOnly = originalName.replace(/\s*\(\d+명\)$/, '');
  await teamCellLink.click();
  await staff.waitForURL(/\/teams\/[^/]+$/);

  const header = staff.locator('[data-slot="page-header"]').first();
  await expect(header).toBeVisible();
  await captureRegion(header, testInfo, 'after-element-team-header');
  await capture(staff, testInfo, 'after-desktop-team-detail');

  // When: 창을 열어 새 이름으로 저장한다.
  // 보조 액션이라 글자가 아니라 아이콘이다 — 접근 가능한 이름으로 찾고, 그 이름이
  // 팀마다 고유한지도 함께 확인한다(design.md R-27).
  const trigger = staff.getByRole('button', {
    name: `${teamNameOnly} 수정`,
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = staff.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // 저장소 이름은 발급 시점 팀명으로 굳으므로 누르기 전에 그 사실을 말한다.
  await expect(dialog).toContainText(
    'GitHub 저장소 이름은 따라 바뀌지 않습니다',
  );
  await captureRegion(dialog, testInfo, 'after-element-rename-dialog');

  const input = dialog.locator('#team-name');
  await expect(input).toHaveValue(teamNameOnly);
  // 지금 이름 그대로는 바뀔 것이 없어 저장할 수 없다.
  await expect(
    dialog.getByRole('button', { name: '저장', exact: true }),
  ).toBeDisabled();
  await input.fill(RENAMED);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();

  // Then: 제목과 알림이 새 이름을 말한다.
  await expect(staff.getByRole('alertdialog')).toHaveCount(0);
  await expect(header).toContainText(RENAMED);
  await expect(staff.getByText('팀 이름을 바꿨습니다')).toBeVisible();
  await captureRegion(header, testInfo, 'after-element-team-header-renamed');
  await capture(staff, testInfo, 'after-desktop-team-renamed');

  // Then: 새로고침해도 남는다 — 화면 상태가 아니라 저장된 사실이다.
  await staff.reload();
  await expect(
    staff.locator('[data-slot="page-header"]').first(),
  ).toContainText(RENAMED);

  // Then: 신청자 목록도 같은 이름을 보여 준다.
  await staff.goto(`/programs/${encodeURIComponent(programId)}/applicants`);
  await expect(staff.getByRole('table')).toContainText(RENAMED);
  await capture(staff, testInfo, 'after-desktop-applicants');
});

/**
 * 좋은 화면이 넣은 자리는 좌우로 스크롤하는 표 오른쪽이 아니라 제목 옆이다.
 * 390폭에서 그 버튼이 살아 있고 창이 화면을 넘지 않는지까지 확인한다.
 */
test.describe('좁은 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390폭에서도 팀명을 고칠 수 있다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    const control = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(control);
    const programId = await fixtureProgramId(control);
    await expectApiStatus(
      await control.request.post(
        `${PROGRAM_AUTHORING_CONTROL_PATH}/applications`,
        { data: { mode: 'NEW' } },
      ),
      201,
    );

    const staff = await programAuthoringActorPage('staff');
    await staff.goto(`/programs/${encodeURIComponent(programId)}/applicants`);
    await capture(staff, testInfo, 'after-mobile-applicants');
    const teamCellLink = staff
      .getByRole('table')
      .locator('a[href*="/teams/"]')
      .first();
    await expect(teamCellLink).toBeVisible();
    await teamCellLink.click();
    await staff.waitForURL(/\/teams\/[^/]+$/);
    await capture(staff, testInfo, 'after-mobile-team-detail');

    const trigger = staff.getByRole('button', { name: /수정$/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = staff.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await capture(staff, testInfo, 'after-mobile-rename-dialog');

    await dialog.locator('#team-name').fill(RENAMED);
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(staff.getByRole('alertdialog')).toHaveCount(0);
    await expect(
      staff.locator('[data-slot="page-header"]').first(),
    ).toContainText(RENAMED);
    await capture(staff, testInfo, 'after-mobile-team-renamed');
  });
});
