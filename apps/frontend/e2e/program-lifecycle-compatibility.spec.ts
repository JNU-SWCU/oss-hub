import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

test.use({ timezoneId: 'Asia/Seoul' });

type ResponseMode = 'published' | 'omitted' | 'archived' | 'invalid';

async function adaptLifecycle(
  page: Page,
  mode: ResponseMode,
  programId: string,
): Promise<void> {
  if (mode === 'published') return;
  const programPath = `/api/v1/programs/${encodeURIComponent(programId)}`;
  await page.route(
    (url) =>
      [
        '/api/v1/programs',
        '/api/v1/dashboard/staff/summary',
        programPath,
        `${programPath}/viewer`,
        `${programPath}/overview`,
        `${programPath}/edit`,
      ].includes(url.pathname),
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const payload: unknown = await response.json();
      if (typeof payload !== 'object' || payload === null)
        throw new Error('Expected a real program response object.');
      const programs: readonly unknown[] =
        'items' in payload && Array.isArray(payload.items)
          ? payload.items
          : 'programs' in payload && Array.isArray(payload.programs)
            ? payload.programs
            : [payload];
      for (const program of programs) {
        if (typeof program !== 'object' || program === null)
          throw new Error('Expected a real program response item.');
        if (mode === 'omitted') Reflect.deleteProperty(program, 'lifecycle');
        else
          Reflect.set(
            program,
            'lifecycle',
            mode === 'archived' ? 'ARCHIVED' : null,
          );
      }
      await route.fulfill({ response, json: payload });
    },
  );
}

for (const width of [1440, 390]) {
  for (const mode of ['published', 'omitted', 'archived', 'invalid'] as const) {
    test(`실제 API 기반 게시 상태 ${mode} 호환성 (${width}px)`, async ({
      authSeedPage,
      programAuthoringActorPage,
    }, testInfo) => {
      const control = await authSeedPage('admin-confirmed');
      const now = await resetProgramAuthoringControl(control);
      const programId = await fixtureProgramId(control);
      const staff = await programAuthoringActorPage('staff');
      const student = await programAuthoringActorPage('foreignStudent');
      for (const page of [staff, student]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.clock.setFixedTime(new Date(Date.parse(now) - 60_000));
        await adaptLifecycle(page, mode, programId);
      }
      const detailPath = `/programs/${encodeURIComponent(programId)}`;
      await student.goto('/programs');
      const card = student.locator('[data-slot="program-card"]').filter({
        hasText: 'e2e:program-authoring:program',
      });
      if (mode === 'invalid') {
        await expect(card).toHaveCount(0);
        await expect(
          student.getByRole('button', { name: '다시 시도' }),
        ).toBeVisible();
      } else {
        await expect(card).toBeVisible();
        await expect(card).toContainText(
          mode === 'archived' ? '종료' : '모집중',
        );
      }
      await student.goto(detailPath);
      if (mode === 'invalid') {
        await expect(
          student.getByText('프로그램을 불러오지 못했습니다', { exact: true }),
        ).toBeVisible();
      } else {
        await expect(student.getByLabel('프로그램 요약')).toBeVisible();
        const badge = student.locator(
          '[data-slot="page-header-title"] [data-slot="status-badge"]',
        );
        await expect(badge).toHaveText(mode === 'archived' ? '종료' : '모집중');
        if (mode === 'archived') {
          await expect(
            student.getByRole('button', { name: '신청하기', exact: true }),
          ).toBeDisabled();
        } else {
          await expect(
            student.getByRole('link', { name: '신청하기', exact: true }),
          ).toHaveAttribute('href', `${detailPath}/apply`);
        }
      }
      await student.screenshot({
        path: testInfo.outputPath(`${mode}-student-detail-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await staff.goto('/dashboard');
      if (mode === 'invalid') {
        await expect(
          staff.getByText('운영 대시보드를 불러오지 못했습니다', {
            exact: true,
          }),
        ).toBeVisible();
      } else {
        await expect(
          staff.getByRole('link', {
            name: 'e2e:program-authoring:program 편집',
            exact: true,
          }),
        ).toBeVisible();
      }
      await staff.screenshot({
        path: testInfo.outputPath(`${mode}-staff-dashboard-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await staff.goto(`${detailPath}/edit`);
      if (mode === 'invalid') {
        await expect(
          staff.getByText('프로그램을 불러오지 못했습니다', { exact: true }),
        ).toBeVisible();
      } else {
        await expect(staff.getByLabel('프로그램명 *')).toHaveValue(
          'e2e:program-authoring:program',
        );
        await expect(
          staff.getByRole('button', { name: '내리기', exact: true }),
        ).toHaveCount(0);
      }
      await staff.screenshot({
        path: testInfo.outputPath(`${mode}-staff-edit-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}
