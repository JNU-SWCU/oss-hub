import type { APIResponse, Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { originHeaders } from './support/program-authoring-ui';

async function responseId(
  response: APIResponse,
  status: number,
): Promise<string> {
  expect(response.status()).toBe(status);
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('id' in body) ||
    typeof body.id !== 'string'
  )
    throw new TypeError('Expected a resource id');
  return body.id;
}

async function participant(control: Page, page: Page) {
  const now = new Date();
  await page.clock.setFixedTime(now);
  const time = now.getTime();
  const programId = await responseId(
    await control.request.post('/api/v1/programs', {
      headers: originHeaders(),
      data: {
        name: '합성 화면 전환 프로그램',
        organizer: '합성 검증 기관',
        trackType: 'EXTRACURRICULAR',
        applicationStartAt: new Date(time - 86_400_000).toISOString(),
        applicationEndAt: new Date(time + 86_400_000).toISOString(),
        endAt: new Date(time + 7 * 86_400_000).toISOString(),
        teamMinSize: 1,
        teamMaxSize: 1,
        description: '탭 안의 운영 상태 검증',
      },
    }),
    201,
  );
  const applicationId = await responseId(
    await page.request.post(`/api/v1/programs/${programId}/applications`, {
      headers: originHeaders(),
      data: {
        answers: { title: '합성 신청' },
        teamName: '합성 전환 팀',
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: false,
      },
    }),
    201,
  );
  const approved = await control.request.patch(
    `/api/v1/applications/${applicationId}`,
    {
      headers: originHeaders(),
      data: { action: 'APPROVE' },
    },
  );
  expect(approved.status()).toBe(200);
  const teamId = await responseId(
    await page.request.get(`/api/v1/programs/${programId}/teams/me`),
    200,
  );
  return { programId, teamId, path: `/programs/${programId}` };
}

function viewerResponse(page: Page, programId: string, operations: boolean) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api/v1/programs/${programId}/viewer` &&
      (url.searchParams.get('view') === 'operations') === operations &&
      response.ok()
    );
  });
}

test('운영 전환은 깨끗한 URL로 탐색하고 새로고침 뒤에도 학생 조회를 하지 않는다', async ({
  authSeedPage,
}, testInfo) => {
  const control = await authSeedPage('admin-confirmed');
  const page = await authSeedPage('staff-revocable');
  const { programId, path } = await participant(control, page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  const sidebar = page.locator('[data-slot="program-scope-sidebar"]');
  await sidebar
    .getByRole('button', { name: '운영 도구로 전환', exact: true })
    .click();
  await expect(
    sidebar.getByRole('button', { name: '학생 화면으로 전환', exact: true }),
  ).toBeVisible();
  await sidebar.getByRole('link', { name: /^게시판/ }).click();
  await expect(page).toHaveURL(new RegExp(`${path}/board$`));
  await sidebar
    .getByRole('link', { name: '프로그램 개요', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === `/api/v1/programs/${programId}/viewer` ||
      url.pathname === `/api/v1/programs/${programId}/overview`
    )
      requests.push(url);
  });
  const loaded = viewerResponse(page, programId, true);
  await page.reload();
  await loaded;
  await expect(sidebar.getByRole('link', { name: /^팀 관리/ })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every((url) => url.searchParams.get('view') === 'operations'),
  ).toBe(true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath(`operations-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const student = viewerResponse(page, programId, false);
  await sidebar
    .getByRole('button', { name: '학생 화면으로 전환', exact: true })
    .click();
  await student;
  await expect(
    sidebar.getByRole('link', { name: '우리 팀', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('팀 상세 직접 진입도 운영 상태를 저장하고 개요에서 학생 화면으로 돌아간다', async ({
  authSeedPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  const page = await authSeedPage('staff-revocable');
  const { programId, teamId, path } = await participant(control, page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${path}/teams/${teamId}`);
  const sidebar = page.locator('[data-slot="program-scope-sidebar"]');
  await expect(
    sidebar.getByRole('button', { name: '학생 화면으로 전환', exact: true }),
  ).toBeVisible();
  const loaded = viewerResponse(page, programId, true);
  await sidebar
    .getByRole('link', { name: '프로그램 개요', exact: true })
    .click();
  await loaded;
  await expect(sidebar.getByRole('link', { name: /^팀 관리/ })).toBeVisible();
  const student = viewerResponse(page, programId, false);
  await sidebar
    .getByRole('button', { name: '학생 화면으로 전환', exact: true })
    .click();
  await student;
  await expect(
    sidebar.getByRole('link', { name: '우리 팀', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('storage가 차단되어도 한 페이지 안에서 전환을 유지한다', async ({
  authSeedPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  const page = await authSeedPage('staff-revocable');
  const { programId, path } = await participant(control, page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  const sidebar = page.locator('[data-slot="program-scope-sidebar"]');
  const operations = viewerResponse(page, programId, true);
  await sidebar
    .getByRole('button', { name: '운영 도구로 전환', exact: true })
    .click();
  await operations;
  await sidebar.getByRole('link', { name: /^게시판/ }).click();
  const overview = viewerResponse(page, programId, true);
  await sidebar
    .getByRole('link', { name: '프로그램 개요', exact: true })
    .click();
  await overview;
  const student = viewerResponse(page, programId, false);
  await sidebar
    .getByRole('button', { name: '학생 화면으로 전환', exact: true })
    .click();
  await student;
  expect(new URL(page.url()).search).toBe('');
});

test('학생이 옛 운영 query를 열어도 학생 API와 학생 화면을 유지한다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  const control = await authSeedPage('admin-confirmed');
  const page = await programAuthoringActorPage('foreignStudent');
  const { programId, path } = await participant(control, page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/\/(?:viewer|overview)$/.test(url.pathname)) requests.push(url);
  });
  const loaded = viewerResponse(page, programId, false);
  await page.goto(`${path}?${new URLSearchParams({ view: 'operations' })}`);
  await loaded;
  await expect(
    page.getByRole('button', { name: '운영 도구로 전환', exact: true }),
  ).toHaveCount(0);
  expect(requests.every((url) => !url.searchParams.has('view'))).toBe(true);
});
