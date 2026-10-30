import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

for (const width of [1440, 390]) {
  test.describe(`게시판 메뉴 수 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('공지 작성과 삭제 후 새로고침 없이 수를 갱신하고 삭제 취소는 유지한다', async ({
      authSeedPage,
      programAuthoringActorPage,
    }, testInfo) => {
      const control = await authSeedPage('admin-confirmed');
      await resetProgramAuthoringControl(control);
      const programId = await fixtureProgramId(control);
      const page = await programAuthoringActorPage('staff');
      const boardPath = `/programs/${encodeURIComponent(programId)}/board`;
      const overviewPath = `/api/v1/programs/${encodeURIComponent(programId)}/overview`;
      let overviewRequests = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === overviewPath)
          overviewRequests += 1;
      });
      const checkCount = async (count: number, label: string) => {
        if (width === 390) {
          await page
            .getByRole('button', { name: '사이드바 메뉴 열기', exact: true })
            .click();
        }
        const scope = page.locator(
          width === 390
            ? '[data-slot="sidebar-drawer"]'
            : '[data-slot="program-scope-sidebar"]',
        );
        const board = scope.locator('a').filter({ hasText: '게시판' });
        try {
          await expect(
            board.locator('[data-slot="program-scope-sidebar-count"]'),
          ).toHaveText(String(count));
        } finally {
          await board.screenshot({
            path: testInfo.outputPath(`${label}-element.png`),
          });
          await page.screenshot({
            path: testInfo.outputPath(`${label}-viewport.png`),
          });
        }
        if (width === 390) {
          await page
            .getByRole('button', { name: '사이드바 메뉴 닫기', exact: true })
            .click();
        }
      };
      await page.goto(boardPath);
      await checkCount(0, 'empty');
      await page
        .getByRole('button', { name: '공지 쓰기', exact: true })
        .click();
      await page
        .getByLabel('제목', { exact: true })
        .fill('합성 메뉴 수 확인 공지');
      await page
        .getByLabel('내용', { exact: true })
        .fill('합성 게시글 변경 후 수를 확인합니다.');
      await page.getByRole('button', { name: '올리기', exact: true }).click();
      await expect(
        page.getByRole('heading', {
          name: '합성 메뉴 수 확인 공지',
          exact: true,
        }),
      ).toBeVisible();
      await checkCount(1, 'created');
      const beforeCancel = overviewRequests;
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('button', { name: '삭제', exact: true }).click();
      await checkCount(1, 'cancelled');
      expect(overviewRequests).toBe(beforeCancel);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: '삭제', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '게시판', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: '합성 메뉴 수 확인 공지', exact: true }),
      ).toHaveCount(0);
      await checkCount(0, 'deleted');
    });
  });
}
