import { expect, test } from './admin-session.fixture';

// Playwright snapshot injection itself produces blocked-script errors in opaque srcdoc frames.
test.use({ trace: 'off' });

test('프로그램별 실제 메일을 확인하고 모바일 탭을 바꿔도 초안을 보존한다', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revocable');
  const programId = encodeURIComponent('seed:e2e:deadline-digest:program');
  let sendRequests = 0;
  await page.route('**/deadline-digest/send', async (route) => {
    sendRequests += 1;
    await route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/programs/${programId}/edit`);
  const control = page.getByTestId('program-deadline-control');
  await expect(
    control.getByRole('button', { name: '안내 보내기' }),
  ).toBeDisabled();
  await control
    .getByLabel('학생용 추가 안내', { exact: true })
    .fill('합성 학생 안내 <태그>');
  await control
    .getByLabel('교직원용 추가 안내', { exact: true })
    .fill('합성 교직원 안내');
  await control.getByRole('button', { name: '발송 대상 미리보기' }).click();
  const studentFrame = page.frameLocator('iframe[title="학생용 메일 본문"]');
  const staffFrame = page.frameLocator('iframe[title="교직원용 메일 본문"]');
  await expect(
    studentFrame.getByText('합성 학생 안내 <태그>', { exact: true }),
  ).toBeVisible();
  await expect(
    staffFrame.getByText('합성 교직원 안내', { exact: true }),
  ).toBeVisible();
  const studentLink = studentFrame.getByRole('link').first();
  await expect(studentLink).toHaveAttribute(
    'href',
    new RegExp(`/programs/${programId}#milestone-.*-name$`),
  );
  await expect(studentLink).toHaveAttribute('target', '_blank');
  await expect(studentLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(staffFrame.getByRole('link').first()).toHaveAttribute(
    'href',
    /\/dashboard$/,
  );
  for (const link of [studentLink, staffFrame.getByRole('link').first()]) {
    const destination = await link.getAttribute('href');
    if (destination === null) throw new Error('Missing preview destination');
    const [opened] = await Promise.all([
      page.waitForEvent('popup'),
      link.click(),
    ]);
    await expect(opened).toHaveURL(destination);
    if (new URL(destination).pathname.endsWith('/dashboard')) {
      await expect(
        opened.getByRole('heading', { name: '운영 대시보드' }),
      ).toBeVisible();
    } else {
      await expect(
        opened.locator(
          `[id="${decodeURIComponent(new URL(destination).hash.slice(1))}"]`,
        ),
      ).toBeVisible();
      const recipient = await authSeedPage('student-confirmed');
      const session = await recipient.request.get('/api/v1/auth/session');
      expect(await session.json()).toMatchObject({
        isAuthenticated: true,
        user: { memberKind: 'STUDENT', isProfileComplete: true },
      });
      const milestoneId = encodeURIComponent(
        'seed:e2e:deadline-digest:milestone',
      );
      await recipient.goto(
        `/programs/${programId}/submissions?milestoneId=${milestoneId}`,
      );
      await expect(
        recipient.getByRole('heading', { name: 'E2E 최종 제출', exact: true }),
      ).toBeVisible();
      await testInfo.attach('legacy-destination-modern-item-count', {
        body: String(
          await recipient.getByTestId('milestone-document-row').count(),
        ),
        contentType: 'text/plain',
      });
      await recipient.screenshot({
        path: testInfo.outputPath('student-legacy-destination.png'),
      });
      const landing = await recipient.goto(destination);
      expect(landing?.status()).toBe(200);
      await expect(recipient).toHaveURL(destination);
      const requiredItem = recipient
        .getByTestId('milestone-document-row')
        .filter({ hasText: 'E2E 최종 보고서' });
      await expect(requiredItem).toBeVisible();
      await requiredItem.getByRole('button', { name: '올리기' }).click();
      await expect(requiredItem.getByLabel('내용 (선택)')).toBeEditable();
      await requiredItem.screenshot({
        path: testInfo.outputPath('student-cta-required-item.png'),
      });
      await recipient.close();
    }
    expect(await opened.evaluate(() => window.opener === null)).toBe(true);
    await opened.close();
    await expect(
      control.getByLabel('학생용 추가 안내', { exact: true }),
    ).toHaveValue('합성 학생 안내 <태그>');
    await expect(
      control.getByLabel('교직원용 추가 안내', { exact: true }),
    ).toHaveValue('합성 교직원 안내');
  }
  await page
    .getByRole('region', { name: '메일 본문 미리보기' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('mail-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await control.getByRole('tab', { name: '교직원용', exact: true }).click();
  await expect(
    control.getByRole('tabpanel', { name: '교직원용 메일' }),
  ).toBeVisible();
  await expect(
    control.getByRole('tabpanel', { name: '학생용 메일' }),
  ).toBeHidden();
  await control
    .getByRole('tabpanel', { name: '교직원용 메일' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('mail-mobile.png') });
  await control
    .getByLabel('학생용 추가 안내', { exact: true })
    .fill('수정한 합성 학생 안내');
  await expect(
    control.getByRole('button', { name: '안내 보내기' }),
  ).toBeDisabled();
  await expect(
    control.getByLabel('교직원용 추가 안내', { exact: true }),
  ).toHaveValue('합성 교직원 안내');
  await control.getByRole('button', { name: '다시 미리보기' }).click();
  await expect(
    control.getByRole('tab', { name: '교직원용', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    control.getByRole('button', { name: '안내 보내기' }),
  ).toBeEnabled();
  expect(sendRequests).toBe(0);
});
