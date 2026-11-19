import { expect, test, type Page } from '@playwright/test';
import { CONSENTED_RESPONSE } from './support/member-access-fixture';
import { authenticatedSessionBody } from './support/session-mock';

const programId = 'mail-review-check';

async function installRoutes(page: Page) {
  let previewRequests = 0;
  let sendRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/consents/current')
      return route.fulfill({ json: CONSENTED_RESPONSE });
    if (path === '/api/v1/auth/session')
      return route.fulfill({ json: authenticatedSessionBody('staff') });
    if (path === `/api/v1/programs/${programId}/overview`)
      return route.fulfill({
        json: {
          name: '메일 검토 프로그램',
          boardPostCount: 0,
          participantCount: 201,
          teamCount: 1,
          connectedRepositoryCount: 0,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          scheduleMilestones: [],
          requirements: [],
        },
      });
    const program = {
      id: programId,
      name: '메일 검토 프로그램',
      organizers: ['JNU SWCU'],
      trackType: 'EXTRACURRICULAR',
      applicationTemplateKey: 'oss-contest',
      repositoryProvisioningEnabled: false,
      description: '메일 화면 검토용 합성 프로그램',
      applicationPeriod: {
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-30T23:59:59.000Z',
      },
      viewer: { role: 'STAFF', applicationStatus: null },
      milestones: [],
    };
    if (
      path === `/api/v1/programs/${programId}/viewer` ||
      path === `/api/v1/programs/${programId}/edit`
    )
      return route.fulfill({ json: program });
    if (path === `/api/v1/programs/${programId}`)
      return route.fulfill({
        json: { ...program, viewer: { role: null, applicationStatus: null } },
      });
    if (path === `/api/v1/programs/${programId}/activity`)
      return route.fulfill({ json: [] });
    if (path === `/api/v1/programs/${programId}/mail/recipients`)
      return route.fulfill({
        json: {
          programId,
          programName: '메일 검토 프로그램',
          recipientLimit: 200,
          teams: [
            {
              id: 'team-1',
              name: '합성 팀',
              status: 'APPROVED',
              deadlineEligible: true,
              applicants: Array.from({ length: 201 }, (_, index) => ({
                id: `student-${index}`,
                displayName: `합성 학생 ${index}`,
                nickname: `student-${index}`,
                mailAvailable: true,
              })),
            },
          ],
        },
      });
    if (path === `/api/v1/programs/${programId}/mail/preview`) {
      previewRequests += 1;
      return route.fulfill({ status: 500, json: {} });
    }
    if (path === `/api/v1/programs/${programId}/mail/send`) {
      sendRequests += 1;
      return route.fulfill({ status: 500, json: {} });
    }
    throw new Error(`Unexpected request: ${request.method()} ${path}`);
  });
  return {
    counts: () => ({ previewRequests, sendRequests }),
  };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`mail recipient limit at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await installRoutes(page);
    await page.goto(`/programs/${programId}`);
    await page.getByRole('button', { name: '메일 보내기' }).click();
    const dialog = page.getByRole('dialog', { name: '메일 보내기' });
    await dialog.locator('#program-mail-subject').fill('합성 제목');
    await dialog.locator('#program-mail-body').fill('합성 본문');
    await dialog.getByRole('button', { name: '전체 선택' }).click();

    expect(await dialog.getByRole('alert').isVisible()).toBe(true);
    expect(
      await dialog.getByRole('button', { name: '미리보기' }).isDisabled(),
    ).toBe(true);
    expect(await dialog.locator('input[type=checkbox]:checked').count()).toBe(
      0,
    );
    expect(fixture.counts()).toEqual({ previewRequests: 0, sendRequests: 0 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  });
}

test('retired notifications URL redirects permanently to the overview', async ({
  page,
}) => {
  await installRoutes(page);
  const response = await page.goto(`/programs/${programId}/notifications`);
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();
  expect(redirectResponse?.status()).toBe(308);
  expect(new URL(page.url()).pathname).toBe(`/programs/${programId}`);
});
