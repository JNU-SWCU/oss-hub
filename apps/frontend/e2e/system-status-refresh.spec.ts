import { expect, test } from './admin-session.fixture';

for (const width of [1440, 390]) {
  test(`수집 접수 후 상태 실패는 조회만 재시도한다 ${width}px`, async ({
    adminPage,
    expectAdminResourceStatusError,
  }, testInfo) => {
    expectAdminResourceStatusError(503);
    await adminPage.setViewportSize({ width, height: 844 });
    let posts = 0;
    let reads = 0;
    let accepted = false;
    await adminPage.route(
      '**/api/v1/admin/collection/trigger',
      async (route) => {
        posts += 1;
        accepted = true;
        await route.fulfill({
          status: 202,
          json: { status: 'PENDING', runId: 'synthetic-run' },
        });
      },
    );
    await adminPage.route('**/api/v1/system-status', async (route) => {
      if (accepted) reads += 1;
      if (accepted && reads <= 2) {
        await route.fulfill({
          status: 503,
          json: {
            type: 'about:blank',
            title: 'Unavailable',
            status: 503,
            detail: '합성 조회 실패',
            code: 'TST_001',
            instance: '/api/v1/system-status',
          },
        });
      } else {
        await route.continue();
      }
    });
    await adminPage.goto('/dashboard/system-status');
    await expect(
      adminPage.getByRole('heading', { name: '시스템 상태', exact: true }),
    ).toBeVisible();
    await adminPage.getByRole('button', { name: '지금 수집 실행' }).click();
    await expect(
      adminPage.getByText('수집 요청을 접수했습니다.'),
    ).toBeVisible();
    await expect(
      adminPage.getByText(
        '마지막으로 확인한 상태를 표시합니다. 다시 불러와 주세요.',
      ),
    ).toBeVisible();
    await adminPage.screenshot({
      path: testInfo.outputPath('accepted-stale.png'),
      fullPage: true,
    });
    await adminPage.getByRole('button', { name: '상태 다시 불러오기' }).click();
    await expect(
      adminPage.getByRole('button', { name: '상태 다시 불러오기' }),
    ).toBeVisible();
    await adminPage.getByRole('button', { name: '상태 다시 불러오기' }).click();
    await expect(
      adminPage.getByRole('button', { name: '상태 다시 불러오기' }),
    ).toHaveCount(0);
    await expect(
      adminPage.getByText('수집 요청을 접수했습니다.'),
    ).toBeVisible();
    expect(posts).toBe(1);
    expect(reads).toBe(3);
    await adminPage.screenshot({
      path: testInfo.outputPath('accepted-current.png'),
      fullPage: true,
    });
  });
}
