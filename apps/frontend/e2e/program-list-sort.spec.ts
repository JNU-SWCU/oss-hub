import { expect, test } from './admin-session.fixture';
import { COVER_PNG } from './support/program-cover';
import { isRecord } from '../src/lib/is-record';
import {
  originHeaders,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

test.use({ timezoneId: 'Asia/Seoul' });

for (const width of [1440, 390]) {
  test(`정렬 기준과 기존 내림차순 주소를 보존한다 (${width}px)`, async ({
    authSeedPage,
  }, testInfo) => {
    const control = await authSeedPage('admin-confirmed');
    const now = await resetProgramAuthoringControl(control);
    const page = await authSeedPage('staff-revocable');
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.clock.setFixedTime(new Date(now));
    const date = (days: number) =>
      new Date(Date.parse(now) + days * 86400000).toISOString();
    const prefix = `QA171-${width}`;
    const names = ['가나다', '나다라', '다라마', '라마바'].map(
      (name) => `${prefix} ${name}`,
    );

    const periods = [
      [-3, 3, 10],
      [-20, -10, 10],
      [5, 10, 20],
      [-40, -30, -20],
    ];
    for (const [index, period] of periods.entries()) {
      const response = await page.request.post('/api/v1/programs', {
        headers: originHeaders(),
        data: {
          name: names[index],
          organizer: '합성 정렬 검증',
          trackType: 'EXTRACURRICULAR',
          applicationStartAt: date(period[0]),
          applicationEndAt: date(period[1]),
          endAt: date(period[2]),
          description: '정렬 방향 확인용 합성 프로그램',
          teamMinSize: 1,
          teamMaxSize: 1,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
    }

    await page.route('**/api/v1/programs/*/cover/*', (route) =>
      route.fulfill({ contentType: 'image/png', body: COVER_PNG }),
    );
    await page.route('**/api/v1/programs?*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('status') !== 'current') {
        await route.continue();
        return;
      }
      url.searchParams.set('status', 'all');
      const response = await route.fetch({ url: url.toString() });
      expect(response.status()).toBe(200);
      const result: unknown = await response.json();
      if (!isRecord(result) || !Array.isArray(result.items)) {
        throw new Error('프로그램 목록 응답이 아닙니다');
      }
      const items = result.items.filter((program: unknown) => {
        if (
          !isRecord(program) ||
          (program.endAt !== null && typeof program.endAt !== 'string')
        ) {
          throw new Error('프로그램 종료일이 없습니다');
        }
        return (
          program.lifecycle !== 'ARCHIVED' &&
          (program.endAt === null ||
            Date.parse(program.endAt) >= Date.parse(now))
        );
      });
      await route.fulfill({
        json: {
          ...result,
          items,
          totalItems: items.length,
          totalPages: items.length ? 1 : 0,
        },
      });
    });
    await page.route('**/api/v1/programs/ended-years', (route) =>
      route.fulfill({ json: { years: [2026] } }),
    );
    await page.goto('/programs');
    const search = page.getByRole('textbox', { name: '프로그램명 검색' });
    const select = page.getByRole('combobox', { name: '프로그램 정렬 기준' });
    const toolbar = page.locator(
      'section.grid.gap-6 > div.flex.flex-col:nth-of-type(2)',
    );
    await expect(select).toHaveValue('');
    await expect(toolbar.getByRole('button')).toHaveCount(0);
    await expect(
      page.locator('[data-slot="program-card"]').first(),
    ).toBeVisible();
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    const selectBox = await select.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(selectBox).not.toBeNull();
    if (!searchBox || !selectBox)
      throw new Error('정렬 컨트롤이 보이지 않습니다');
    expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(width);
    expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(width);
    expect(
      width === 390
        ? selectBox.y >= searchBox.y + searchBox.height
        : selectBox.x >= searchBox.x + searchBox.width,
    ).toBe(true);
    const screenshotOptions = {
      animations: 'disabled' as const,
      style: 'nextjs-portal { display: none !important; }',
    };
    await toolbar.screenshot({
      path: testInfo.outputPath(`1246-after-element-sortbar-${width}.png`),
      ...screenshotOptions,
    });
    await page.screenshot({
      path: testInfo.outputPath(
        `1246-after-${width === 390 ? 'mobile' : 'desktop'}-programs-${width}.png`,
      ),
      ...screenshotOptions,
    });

    await page
      .context()
      .storageState({ path: testInfo.outputPath('staff-state.json') });

    await search.fill(prefix);
    const cards = page.locator('[data-slot="program-card"]');
    const currentNames = names.slice(0, 3);
    await expect(cards).toHaveCount(3);
    await expect(cards).toContainText([names[0], names[2], names[1]]);
    await select.selectOption('name');
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('sort') === 'name' &&
        url.searchParams.get('search') === prefix,
    );
    await expect(cards).toContainText(currentNames);
    await select.selectOption('applicationPeriod');
    await expect(cards).toContainText([names[1], names[0], names[2]]);
    await select.selectOption('status');
    await expect(cards).toContainText(currentNames);
    await page.goto('/programs?sort=name&direction=desc');
    await expect(select).toHaveValue('name');
    await search.fill(prefix);
    await expect(cards).toContainText([...currentNames].reverse());
    await expect(toolbar.getByRole('button')).toHaveCount(0);

    await page.goto('/programs?status=ended&sort=name');
    await expect(select).toHaveValue('name');
    await search.fill(prefix);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText([names[3]]);
  });
}
