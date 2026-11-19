import { expect, test } from '@playwright/test';
import {
  installMailReviewRoutes,
  mailReviewProgramId,
} from './support/mail-review-fixture';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`mail recipient limit at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await installMailReviewRoutes(page);
    await page.goto(`/programs/${mailReviewProgramId}`);
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
    await dialog.screenshot({
      path: test.info().outputPath('recipient-limit.png'),
    });
  });

  test(`mail preview ignores superseded content at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installMailReviewRoutes(page, 1);
    let releaseOld: () => void = () => undefined;
    const oldResponse = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    await page.route('**/mail/preview', async (route) => {
      const draft: unknown = route.request().postDataJSON();
      if (
        typeof draft !== 'object' ||
        draft === null ||
        !('subject' in draft) ||
        typeof draft.subject !== 'string'
      )
        throw new TypeError('Missing preview subject');
      if (draft.subject === 'old subject') await oldResponse;
      return route.fulfill({
        json: {
          ...draft,
          programName: 'Synthetic program',
          senderName: 'Synthetic staff',
          recipientNames: ['Synthetic student'],
          recipientCount: 1,
          renderedSubject: draft.subject,
          footer: 'Synthetic footer',
          previewedAt: '2026-11-19T00:00:00.000Z',
          expiresAt: '2026-11-19T00:10:00.000Z',
          previewVersion:
            draft.subject === 'old subject' ? 'a'.repeat(64) : 'b'.repeat(64),
        },
      });
    });
    let sent: unknown;
    await page.route('**/mail/send', async (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json: {
          status: 'COMPLETED',
          sentCount: 1,
          duplicateCount: 0,
          failedCount: 0,
          previewVersion: 'b'.repeat(64),
        },
      });
    });
    await page.goto(`/programs/${mailReviewProgramId}`);
    await page
      .getByRole('button', { name: '메일 보내기', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: '메일 보내기',
      exact: true,
    });
    await dialog.getByRole('button', { name: '전체 선택' }).click();
    await dialog.locator('#program-mail-subject').fill('old subject');
    await dialog.locator('#program-mail-body').fill('synthetic body');
    const oldRequest = page.waitForRequest('**/mail/preview');
    await dialog.getByRole('button', { name: '미리보기', exact: true }).click();
    await oldRequest;
    await dialog.locator('#program-mail-subject').fill('latest subject');
    const oldFinished = page.waitForResponse('**/mail/preview');
    releaseOld();
    await oldFinished;
    const latestFinished = page.waitForResponse('**/mail/preview');
    await dialog.getByRole('button', { name: '미리보기', exact: true }).click();
    await (await latestFinished).finished();
    await dialog.screenshot({
      path: test.info().outputPath('latest-preview.png'),
    });
    const sendFinished = page.waitForResponse('**/mail/send');
    await dialog.getByRole('button', { name: '보내기', exact: true }).click();
    await sendFinished;
    expect(sent).toMatchObject({
      subject: 'latest subject',
      body: 'synthetic body',
      applicantIds: ['student-0'],
      previewVersion: 'b'.repeat(64),
    });
  });

  test(`deadline guidance sends its previewed version at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installMailReviewRoutes(page, 1);
    await page.route('**/deadline-digest/preview', (route) =>
      route.fulfill({
        json: {
          applicationCount: 1,
          milestoneCount: 1,
          recipientCount: 1,
          inactiveCount: 0,
          optedOutCount: 0,
          noEmailCount: 0,
          staffRecipientCount: 1,
          previewedAt: '2026-11-19T00:00:00.000Z',
          expiresAt: '2026-11-19T00:10:00.000Z',
          previewVersion: 'c'.repeat(64),
          studentPreviews: [
            {
              displayName: 'Synthetic student',
              subject: 'Deadline',
              text: 'Synthetic guidance',
              html: '<p>Synthetic guidance</p>',
            },
          ],
          staffPreview: {
            subject: 'Summary',
            text: 'Synthetic summary',
            html: '<p>Synthetic summary</p>',
          },
        },
      }),
    );
    let sent: unknown;
    await page.route('**/deadline-digest/send', async (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json: {
          sentCount: 1,
          duplicateCount: 0,
          failedCount: 0,
          staffRecipientCount: 1,
        },
      });
    });
    await page.goto(`/programs/${mailReviewProgramId}`);
    await page
      .getByRole('button', { name: '마감 알림 보내기', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: '마감 알림 보내기',
      exact: true,
    });
    await dialog
      .locator('#deadline-studentGuidance')
      .fill('synthetic guidance');
    const previewFinished = page.waitForResponse('**/deadline-digest/preview');
    await dialog.getByRole('button', { name: '미리보기', exact: true }).click();
    await (await previewFinished).finished();
    await dialog.screenshot({
      path: test.info().outputPath('deadline-preview.png'),
    });
    const sendFinished = page.waitForResponse('**/deadline-digest/send');
    await dialog.getByRole('button', { name: '보내기', exact: true }).click();
    await sendFinished;
    expect(sent).toMatchObject({
      studentGuidance: 'synthetic guidance',
      staffGuidance: '',
      previewVersion: 'c'.repeat(64),
    });
  });
}

test('retired notifications URL redirects permanently to the overview', async ({
  page,
}) => {
  await installMailReviewRoutes(page);
  const response = await page.goto(
    `/programs/${mailReviewProgramId}/notifications`,
  );
  const redirectResponse = await response
    ?.request()
    .redirectedFrom()
    ?.response();
  expect(redirectResponse?.status()).toBe(308);
  expect(new URL(page.url()).pathname).toBe(`/programs/${mailReviewProgramId}`);
});
