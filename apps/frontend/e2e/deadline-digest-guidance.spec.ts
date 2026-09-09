import { expect, test } from './admin-session.fixture';

// Tracing injects scripts into the deliberately script-disabled preview frames.
test.use({ trace: 'off' });

test('4000자 안내를 POST 평문으로 미리 보고 작은 화면에서 두 링크까지 이동한다', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revocable');
  const programId = encodeURIComponent('seed:e2e:deadline-digest:program');
  let sendRequests = 0;
  await page.route('**/deadline-digest/send', async (route) => {
    sendRequests += 1;
    await route.abort();
  });
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto(`/programs/${programId}/edit`);
  const control = page.getByTestId('program-deadline-control');
  const longStudent = (
    '<script>합성 학생</script>\n' + '학생용 여러 줄 안내\n'.repeat(400)
  ).slice(0, 4000);
  const longStaff = (
    '<b>합성 교직원</b>\n' + '교직원용 여러 줄 안내\n'.repeat(400)
  ).slice(0, 4000);
  await control
    .getByLabel('학생용 추가 안내', { exact: true })
    .fill(longStudent);
  await control
    .getByLabel('교직원용 추가 안내', { exact: true })
    .fill(longStaff);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/deadline-digest/preview') &&
      response.request().method() === 'POST',
  );
  await control.getByRole('button', { name: '발송 대상 미리보기' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(new URL(response.request().url()).search).toBe('');
  expect(response.request().postDataJSON()).toEqual({
    studentGuidance: longStudent,
    staffGuidance: longStaff,
  });
  for (const audience of ['학생', '교직원']) {
    await control
      .getByRole('tab', { name: `${audience}용`, exact: true })
      .click();
    const iframe = page.locator(`iframe[title="${audience}용 메일 본문"]`);
    const frame = page.frameLocator(`iframe[title="${audience}용 메일 본문"]`);
    await expect(frame.locator('body')).toContainText(
      audience === '학생' ? longStudent : longStaff,
    );
    await expect(frame.locator('script, b')).toHaveCount(0);
    await iframe.scrollIntoViewIfNeeded();
    const frameBox = await iframe.boundingBox();
    if (frameBox === null) throw new Error('Missing visible preview frame');
    await page.mouse.move(
      frameBox.x + frameBox.width / 2,
      Math.max(80, Math.min(400, frameBox.y + frameBox.height / 2)),
    );
    await page.mouse.wheel(0, 20000);
    const link = frame.getByRole('link').first();
    await expect
      .poll(async () =>
        frame
          .locator('body')
          .evaluate(() => document.documentElement.scrollTop),
      )
      .toBeGreaterThan(0);
    const linkBox = await link.boundingBox();
    if (linkBox === null) throw new Error('Missing mail link');
    await page.mouse.move(8, 220);
    await page.mouse.wheel(0, linkBox.y - 220);
    await expect(link).toBeInViewport();
    const geometry = await frame.locator('body').evaluate((body) => ({
      viewportHeight: window.innerHeight,
      scrollTop: document.documentElement.scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      link: body.querySelector('a')?.getBoundingClientRect().toJSON(),
    }));
    await testInfo.attach(`${audience}-long-guidance-geometry`, {
      body: JSON.stringify({
        geometry,
        link: await link.boundingBox(),
        iframe: await iframe.boundingBox(),
      }),
      contentType: 'application/json',
    });
    await expect(link).toHaveAttribute(
      'href',
      audience === '학생'
        ? new RegExp(`/programs/${programId}#milestone-.*-name$`)
        : /\/dashboard$/,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${audience}-long-guidance-link.png`),
    });
  }
  await expect(
    control.getByLabel('학생용 추가 안내', { exact: true }),
  ).toHaveValue(longStudent);
  await expect(
    control.getByLabel('교직원용 추가 안내', { exact: true }),
  ).toHaveValue(longStaff);
  const sendButton = control.getByRole('button', { name: '안내 보내기' });
  await sendButton.scrollIntoViewIfNeeded();
  await expect(sendButton).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('long-guidance-bottom-actions.png'),
  });
  expect(sendRequests).toBe(0);
});
