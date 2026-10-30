import type { APIResponse } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { installBrowserAudit } from './support/browser-audit';
import { originHeaders } from './support/program-authoring-ui';

async function createdId(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(201);
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('id' in body) ||
    typeof body.id !== 'string'
  ) {
    throw new TypeError('Created resource must have an id');
  }
  return body.id;
}

test('참여 조회 실패 시 혼합 권한 계정의 운영 메뉴와 상세 본문이 일치한다', async ({
  authSeedPage,
  browser,
}, testInfo) => {
  const control = await authSeedPage('admin-confirmed');
  const mixed = await authSeedPage('staff-revocable');
  const now = Date.now();
  const programId = await createdId(
    await control.request.post('/api/v1/programs', {
      headers: originHeaders(),
      data: {
        name: '합성 참여 조회 실패 검증',
        organizer: '합성 검증 기관',
        trackType: 'EXTRACURRICULAR',
        applicationStartAt: new Date(now - 86_400_000).toISOString(),
        applicationEndAt: new Date(now + 86_400_000).toISOString(),
        endAt: new Date(now + 7 * 86_400_000).toISOString(),
        teamMinSize: 1,
        teamMaxSize: 1,
        description: '혼합 권한 참여자의 메뉴와 상세 일치 검증',
      },
    }),
  );
  const applicationId = await createdId(
    await mixed.request.post(`/api/v1/programs/${programId}/applications`, {
      headers: originHeaders(),
      data: {
        answers: { title: '합성 신청' },
        teamName: '합성 참여 팀',
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: false,
      },
    }),
  );
  const approval = await control.request.patch(
    `/api/v1/applications/${applicationId}`,
    { headers: originHeaders(), data: { action: 'APPROVE' } },
  );
  expect(approval.status()).toBe(200);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    await context.addCookies(await mixed.context().cookies());
    const page = await context.newPage();
    const audit = installBrowserAudit(page);
    const failurePath = `/api/v1/programs/${programId}/applications/me`;
    await page.route(`**${failurePath}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          title: 'Synthetic participation lookup failure',
          status: 503,
        }),
      }),
    );
    const detailResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/v1/programs/${programId}/viewer` &&
        url.searchParams.get('view') === 'operations' &&
        response.ok()
      );
    });
    await page.goto(`/programs/${programId}`);
    await expect(
      page.getByRole('link', { name: /^팀 관리/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '편집', exact: true }),
    ).toBeVisible();
    expect(await (await detailResponse).json()).toMatchObject({
      viewer: { role: 'STAFF' },
    });
    await expect(
      page.getByRole('button', { name: '운영 도구로 전환', exact: true }),
    ).toHaveCount(0);
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const header = page.locator('main [data-slot="page-header"]').first();
      await expect(
        header.getByRole('link', { name: '편집', exact: true }),
      ).toBeVisible();
      await header.screenshot({
        path: testInfo.outputPath(
          `participation-fallback-${viewport.name}.png`,
        ),
      });
    }
    audit.assertClean([{ status: 503, path: failurePath, method: 'GET' }]);
  } finally {
    await context.close();
  }
});
