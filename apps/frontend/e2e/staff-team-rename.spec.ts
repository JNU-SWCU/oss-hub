import { expect, test } from './admin-session.fixture';
import { capture, captureRegion } from './support/repository-relink-evidence';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

const RENAMED = 'e2e:renamed-team';

test('교직원이 팀 이름을 고치면 새로고침 뒤에도 남는다', async ({
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
  await staff.goto(`/programs/${encodeURIComponent(programId)}/teams`);

  await staff.goto(`/programs/${encodeURIComponent(programId)}/teams`);
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

  const teamNameOnly = originalName.replace(/\s*\(\d+명\)$/, '');
  await teamCellLink.click();
  await staff.waitForURL(/\/teams\/[^/]+$/);

  const header = staff.locator('[data-slot="page-header"]').first();
  await expect(header).toBeVisible();
  await captureRegion(header, testInfo, 'after-element-team-header');
  await capture(staff, testInfo, 'after-desktop-team-detail');

  const trigger = staff.getByRole('button', {
    name: `${teamNameOnly} 수정`,
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('label')).toHaveCount(0);
  await captureRegion(dialog, testInfo, 'after-element-rename-dialog');

  const input = dialog.locator('input[aria-label="팀 이름"]');
  await expect(input).toHaveValue(teamNameOnly);
  await input.fill(RENAMED);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();

  await expect(staff.getByRole('dialog')).toHaveCount(0);
  await expect(header).toContainText(RENAMED);
  await expect(staff.getByText('팀 이름을 바꿨습니다')).toBeVisible();
  await captureRegion(header, testInfo, 'after-element-team-header-renamed');
  await capture(staff, testInfo, 'after-desktop-team-renamed');

  await staff.reload();
  await expect(
    staff.locator('[data-slot="page-header"]').first(),
  ).toContainText(RENAMED);

  await staff.goto(`/programs/${encodeURIComponent(programId)}/teams`);
  await expect(staff.getByRole('table')).toContainText(RENAMED);
  await capture(staff, testInfo, 'after-desktop-team-management');
});

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
    await staff.goto(`/programs/${encodeURIComponent(programId)}/teams`);
    await capture(staff, testInfo, 'after-mobile-team-management');
    const teamCellLink = staff
      .getByRole('table')
      .locator('a[href*="/teams/"]')
      .first();
    await expect(teamCellLink).toBeVisible();
    await teamCellLink.click();
    await staff.waitForURL(/\/teams\/[^/]+$/);
    await capture(staff, testInfo, 'after-mobile-team-detail');

    const trigger = staff.getByRole('button', {
      name: /^(?!저장소 URL 수정$).+ 수정$/,
    });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = staff.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await capture(staff, testInfo, 'after-mobile-rename-dialog');

    await dialog.locator('input[aria-label="팀 이름"]').fill(RENAMED);
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(staff.getByRole('dialog')).toHaveCount(0);
    await expect(
      staff.locator('[data-slot="page-header"]').first(),
    ).toContainText(RENAMED);
    await capture(staff, testInfo, 'after-mobile-team-renamed');
  });
});
