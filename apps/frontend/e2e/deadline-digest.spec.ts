import { expect, test } from './admin-session.fixture';

test('교직원 대시보드에는 전역 즉시 발송 액션이 없고 학생은 실패 원장을 읽지 못한다', async ({
  authSeedPage,
}) => {
  const staffPage = await authSeedPage('staff-revocable');
  await staffPage.goto('/staff/dashboard');
  await expect(
    staffPage.getByRole('heading', { name: '운영 대시보드' }),
  ).toBeVisible();
  await expect(
    staffPage.getByRole('button', { name: '마감 알림 지금 발송' }),
  ).toHaveCount(0);

  const globalSend = await staffPage.request.post(
    '/api/v1/notifications/deadline-digests/send',
  );
  expect(globalSend.status()).toBe(404);

  const studentPage = await authSeedPage('student-confirmed');
  const failures = await studentPage.request.get(
    '/api/v1/notifications/deadline-digests/failures',
  );
  expect(failures.status()).toBe(403);
});
