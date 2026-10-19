import { expect, test } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

test('되돌린 신청과 삭제된 팀을 현재 상태에 맞게 안내하고 선택한 삭제 알림만 확인한다', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const acknowledged: string[] = [];
  const deleted = {
    id: 'synthetic-team-deleted-notice',
    teamId: 'synthetic-deleted-team',
    teamName: '합성 오픈소스 팀',
    programId: 'synthetic-program',
    programName: '합성 오픈소스 프로그램',
    message: '동일한 신청으로 만들어진 중복 팀을 정리했습니다.',
    deletedAt: '2026-10-19T12:00:00.000Z',
  };
  await installSyntheticAuthority(
    page,
    {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    {
      'GET /api/v1/dashboard/student': async (route) =>
        fulfillJson(route, { items: [] }),
      'GET /api/v1/dashboard/student/feedback': async (route) =>
        fulfillJson(route, { items: [] }),
      'GET /api/v1/users/me/notifications/application-decisions': async (
        route,
      ) =>
        fulfillJson(route, [
          {
            id: 'synthetic-revert-notice',
            applicationId: 'synthetic-application',
            programId: 'synthetic-program',
            programName: '합성 오픈소스 프로그램',
            decision: 'SUBMITTED',
            decidedAt: '2026-10-19T11:00:00.000Z',
          },
        ]),
      'PATCH /api/v1/users/me/notifications/application-decisions/synthetic-revert-notice/read':
        async (route) => route.fulfill({ status: 204 }),
      'GET /api/v1/users/me/notifications/team-deletions': async (route) =>
        fulfillJson(route, acknowledged.length ? [] : [deleted]),
      'PATCH /api/v1/users/me/notifications/team-deletions/synthetic-team-deleted-notice/read':
        async (route) => {
          acknowledged.push(deleted.id);
          await route.fulfill({ status: 204 });
        },
      'GET /api/v1/team-invitations/received': async (route) =>
        fulfillJson(route, []),
    },
  );
  await page.goto('/dashboard');
  const decision = page.getByRole('region', { name: '신청 결과 알림' });
  const deletion = page.getByRole('region', { name: '팀 삭제 알림' });
  await expect(
    decision.getByRole('link', { name: '신청 상태 확인' }),
  ).toHaveAttribute('href', '/programs/synthetic-program/apply');
  await expect(
    decision.getByRole('link', { name: '반려 사유 확인' }),
  ).toHaveCount(0);
  await expect(deletion).toContainText(deleted.teamName);
  await expect(deletion).toContainText(deleted.programName);
  await expect(deletion).toContainText(deleted.message);
  await expect(deletion.locator('time')).toHaveAttribute(
    'datetime',
    deleted.deletedAt,
  );
  await expect(
    deletion.getByRole('link', { name: '프로그램 확인' }),
  ).toHaveAttribute('href', '/programs/synthetic-program');
  expect(acknowledged).toEqual([]);

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      deletion.getByRole('button', { name: '확인했어요' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`notification-states-${viewport.name}.png`),
      fullPage: true,
    });
  }

  await deletion.getByRole('button', { name: '확인했어요' }).click();
  await expect(deletion).toHaveCount(0);
  expect(acknowledged).toEqual([deleted.id]);
  await expect(decision).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '내 대시보드', exact: true }),
  ).toBeVisible();
  await expect(deletion).toHaveCount(0);
  audit.assertClean();
});
