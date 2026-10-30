import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
  PROGRAM_AUTHORING_CONTROL_PATH,
} from './support/program-authoring-ui';
import { isRecord } from '../src/lib/is-record';

async function mockPrograms(page: Page, programId: string) {
  const requests: URL[] = [];
  await page.route('**/api/v1/programs?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await route.fulfill({
      json: {
        items: [
          {
            id: programId,
            name: 'x 프로그램',
            organizer: '합성 운영처',
            trackType: 'EXTRACURRICULAR',
            lifecycle: 'PUBLISHED',
            applicationStartAt: '2026-01-01T00:00:00.000Z',
            applicationEndAt: '2026-12-01T00:00:00.000Z',
            endAt: '2026-12-31T00:00:00.000Z',
            description: '',
          },
        ],
        page: Number(url.searchParams.get('page')),
        pageSize: 20,
        totalItems: 40,
        totalPages: 2,
      },
    });
  });
  return requests;
}

test('프로그램 상세에서 뒤로 가면 검색 정렬 페이지가 복원되고 필터는 한 요청으로 페이지를 초기화한다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  const programId = await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff');
  const requests = await mockPrograms(page, programId);
  await page.goto('/programs?sort=name&search=x&page=2');
  const card = page.locator('[data-slot="program-card"]').first();
  await expect(card).toBeVisible();
  await card.locator('xpath=ancestor::a').click();
  await expect(page).toHaveURL(new RegExp('/programs/' + programId + '$'));
  const restoredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('page') === '2' &&
      url.searchParams.get('search') === 'x'
    );
  });
  await page.goBack();
  await restoredResponse;
  await expect(page).toHaveURL(/\/programs\?sort=name&search=x&page=2$/);
  await expect(page.getByLabel('프로그램명 검색')).toHaveValue('x');
  await expect(page.getByLabel('프로그램 정렬 기준')).toHaveValue('name');
  await expect(card).toBeVisible();
  requests.length = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('status') === 'recruiting'
    );
  });
  await page
    .locator('[data-slot="program-list-status-chips"]')
    .getByRole('button', { name: '모집중', exact: true })
    .click();
  await response;
  await expect(
    page.locator('[data-slot="program-card"]').first(),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.searchParams.get('page')).toBe('1');
});

test('잘못된 URL은 기본값으로 조회하고 빠른 검색은 마지막 값만 주소를 대체한다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  const programId = await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff');
  const requests = await mockPrograms(page, programId);
  await page.goto('/programs?page=abc&sort=bad');
  await expect(
    page.locator('[data-slot="program-card"]').first(),
  ).toBeVisible();
  expect(requests[0]?.searchParams.get('page')).toBe('1');
  expect(requests[0]?.searchParams.has('sort')).toBe(false);
  const length = await page.evaluate(() => history.length);
  await page.clock.install();
  requests.length = 0;
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('search') === 'xyz'
    );
  });
  const search = page.getByLabel('프로그램명 검색');
  await search.fill('x');
  await search.fill('xy');
  await search.fill('xyz');
  await page.clock.runFor(300);
  await response;
  await expect(search).toHaveValue('xyz');
  expect(requests.map((url) => url.searchParams.get('search'))).toEqual([
    'xyz',
  ]);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('팀 상세에서 뒤로 가면 teams search와 page를 복원한다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  const created = await control.request.post(
    PROGRAM_AUTHORING_CONTROL_PATH + '/applications',
    { data: { mode: 'NEW' } },
  );
  expect(created.status()).toBe(201);
  const page = await programAuthoringActorPage('staff');
  await page.route(
    '**/api/v1/programs/' + programId + '/applications?*',
    async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set('search', '');
      url.searchParams.set('page', '1');
      const response = await route.fetch({ url: url.toString() });
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        !Array.isArray(body.items) ||
        body.items.length === 0
      )
        throw new Error('팀 목록 seed가 필요합니다');
      await route.fulfill({
        json: { ...body, page: 2, totalItems: 40, totalPages: 2 },
      });
    },
  );
  await page.goto('/programs/' + programId + '/teams?search=x&page=2');
  await expect(page.getByLabel('팀 검색')).toHaveValue('x');
  const team = page.getByRole('table').locator('a[href*="/teams/"]').first();
  await expect(team).toBeVisible();
  await team.click();
  await expect(page).toHaveURL(new RegExp('/teams/[^/?]+$'));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('/teams\\?search=x&page=2$'));
  await expect(page.getByLabel('팀 검색')).toHaveValue('x');
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
});
