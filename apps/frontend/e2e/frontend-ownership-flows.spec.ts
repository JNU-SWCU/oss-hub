import { expect, test } from './admin-session.fixture';
import { fixtureProgramId } from './support/program-authoring-ui';

test('게시판의 작성·수정·삭제와 목록 갱신은 화면 분리 뒤에도 유지된다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  const control = await authSeedPage('admin-confirmed');
  const programId = await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff');
  const title = '합성 소유 경계 게시글';
  await page.goto(
    `/programs/${encodeURIComponent(programId)}/board?view=operations`,
  );
  await page.getByRole('button', { name: '공지 쓰기', exact: true }).click();
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(page.getByLabel('제목', { exact: true })).toBeFocused();
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('내용', { exact: true }).fill('합성 게시판 내용');
  await page.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByLabel('제목', { exact: true })).toBeFocused();
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(
    '합성 게시판 내용',
  );
  await page.getByLabel('제목', { exact: true }).fill(`${title} 수정`);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `${title} 수정`, exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath(`board-detail-${width}.png`),
      fullPage: true,
    });
  }
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/programs/${encodeURIComponent(programId)}/board(?:\\?|$)`),
  );
  await expect(
    page.getByRole('heading', { name: '게시판', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: `${title} 수정`, exact: true }),
  ).toHaveCount(0);
});

test('프로그램 종료 탭은 빈 종료 목록 응답과 연도 URL을 유지한다', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { isAuthenticated: false } }),
  );
  await page.route('**/api/v1/programs?*', (route) =>
    route.fulfill({
      json: { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }),
  );
  await page.route('**/api/v1/programs/ended-years', (route) =>
    route.fulfill({
      json: { years: [2026] },
    }),
  );
  await page.goto('/programs?status=ended');
  await expect(
    page.getByRole('heading', { name: '종료된 프로그램', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('종료된 프로그램이 없습니다', { exact: true }),
  ).toBeVisible();
  const filteredResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/programs' &&
      new URL(response.url()).searchParams.get('status') === 'ended' &&
      new URL(response.url()).searchParams.get('year') === '2026',
  );
  await page.goto('/programs?status=ended&year=2026');
  expect((await filteredResponse).status()).toBe(200);
  await expect(
    page.getByText('조건에 맞는 프로그램이 없습니다', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/programs\?status=ended&year=2026$/);
  await expect(
    page.getByText('조건에 맞는 프로그램이 없습니다', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
  await expect(page).toHaveURL(/\/programs\?status=ended$/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('combobox', { name: '종료 연도' })).toHaveValue(
      '',
    );
    await page.screenshot({
      path: testInfo.outputPath(`PR-programs-ended-empty-${width}.png`),
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
  }
});
