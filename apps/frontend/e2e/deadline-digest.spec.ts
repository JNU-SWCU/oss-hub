import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import {
  authSeedGithubId,
  forgeSessionToken,
  sessionCookieName,
} from './support/session-cookie';

/**
 * 마감 알림: 설정 저장 → 교직원 대시보드 수동 발송 → 학생 API 거부.
 * 스택은 MAIL_MODE=dry-run + auth 시드 + deadline-digest e2e fixture.
 */
test.describe.serial('마감 알림 수신 설정·수동 발송', () => {
  test('교직원이 수신 이메일을 저장하고 대시보드에서 마감 알림을 발송한다', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: sessionCookieName(e2eEnvironment.baseUrl.startsWith('https://')),
        value: forgeSessionToken(
          e2eEnvironment.sessionSecret,
          authSeedGithubId('staff-revocable'),
        ),
        url: e2eEnvironment.baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '설정' })).toBeVisible();
    await expect(page.getByRole('group', { name: '알림 수신' })).toBeVisible();

    const email = page.locator('#settings-notification-email');
    await expect(email).toBeVisible({ timeout: 15_000 });
    await email.fill('staff-revocable@example.com');
    const notify = page.getByRole('checkbox', { name: '마감 임박 알림 받기' });
    if (!(await notify.isChecked())) {
      await notify.check();
    }
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '저장되었습니다' }),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto('/staff/dashboard');
    await expect(
      page.getByRole('heading', { name: '운영 대시보드' }),
    ).toBeVisible({ timeout: 15_000 });
    const sendButton = page.getByRole('button', {
      name: '마감 알림 지금 발송',
    });
    await expect(sendButton).toBeVisible();
    await sendButton.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: '마감 알림 발송을 요청했습니다' }),
    ).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('학생은 마감 알림 수동 발송 API를 호출할 수 없다', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: sessionCookieName(e2eEnvironment.baseUrl.startsWith('https://')),
        value: forgeSessionToken(
          e2eEnvironment.sessionSecret,
          authSeedGithubId('student-confirmed'),
        ),
        url: e2eEnvironment.baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    const response = await page.request.post(
      `${e2eEnvironment.baseUrl.replace(/\/$/, '')}/api/v1/notifications/deadline-digests/send`,
      {
        headers: { Origin: e2eEnvironment.baseUrl },
      },
    );
    // Next rewrites /api/v1 to backend — if not, hit backend port
    if (response.status() === 404) {
      const backend = `http://127.0.0.1:${e2eEnvironment.backendPort}`;
      const cookie = forgeSessionToken(
        e2eEnvironment.sessionSecret,
        authSeedGithubId('student-confirmed'),
      );
      const direct = await page.request.post(
        `${backend}/api/v1/notifications/deadline-digests/send`,
        {
          headers: {
            Origin: e2eEnvironment.baseUrl,
            Cookie: `${sessionCookieName(false)}=${cookie}`,
          },
        },
      );
      expect(direct.status()).toBe(403);
      const body = await direct.json();
      expect(body.code).toBe('NOT_001');
    } else {
      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.code).toBe('NOT_001');
    }
    await context.close();
  });
});
