import { expect, test, type Page } from '@playwright/test';

const target = '/dashboard/insights';

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/local-review/${fixture}?to=${encodeURIComponent(target)}`);
  await page.locator('main').waitFor();
}

test.describe('staff insights comparison UX', () => {
  test('renders long Korean labels at desktop and mobile with keyboard and 200% text', async ({
    page,
  }) => {
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openFixture(page, 'insights-long');
      await page.keyboard.press('Tab');
      await expect(
        page
          .getByRole('cell', {
            name: '2026학년도 전공·비전공 협업을 위한 아주 긴 한국어 프로그램 레이블 테스트',
          })
          .first(),
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expect(
        page.getByRole('group', { name: '비교 관점' }),
      ).toBeVisible();
      await page.screenshot({
        path: `.omo/evidence/task-2-browser/${name}-long-200-text.png`,
        fullPage: true,
      });
    }
  });

  test('renders all-zero state without divide-by-zero output', async ({
    page,
  }) => {
    await openFixture(page, 'insights-zero');
    await expect(page.getByText(/계산 불가|0\/0/).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('NaN');
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/all-zero.png',
      fullPage: true,
    });
  });

  test('renders empty state', async ({ page }) => {
    await openFixture(page, 'insights-empty');
    await expect(page.getByText('승인된 참여가 없습니다')).toBeVisible();
    await page.getByRole('button', { name: '학과' }).click();
    await expect(page.getByText('학과별 학생이 없습니다')).toBeVisible();
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/empty.png',
      fullPage: true,
    });
  });

  test('renders unregistered disclosure and semantic parity', async ({
    page,
  }) => {
    await openFixture(page, 'insights-unregistered');
    await expect(page.getByText(/학과 미등록은 별도 집계/)).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'SW전공과 비SW전공의 랭킹 지표' }),
    ).toBeAttached();
    await expect(page.getByText(/색상 외에도 범례와 좌우 위치/)).toBeVisible();
    await expect(page.locator('main')).toContainText('x/0');
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/unregistered-only.png',
      fullPage: true,
    });
  });
});
