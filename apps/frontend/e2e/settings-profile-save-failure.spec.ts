import { expect, test } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  F3_SAVED_PROFILE,
  installSettingsSaveFailureFixture,
} from './support/f3-account-fixture';
import { captureF3Evidence } from './support/f3-evidence';

const EDITED_NAME = '합성 수정한 이름';

/**
 * 설정에서 프로필 저장이 실패했을 때 — **다시 누를 수 있는 상태로 남는가**.
 *
 * 저장 실패의 진짜 손해는 오류 문구가 아니라 잃어버린 입력이다. 화면이 실패를 알리면서
 * 폼을 불러온 값으로 되돌리면, 사용자는 고쳐 쓴 것을 처음부터 다시 입력해야 한다.
 * 그래서 판정은 네 조각을 함께 본다: 실패를 말하고(destructive alert), 있던 자리에
 * 남고(URL), 고쳐 쓴 값이 입력란에 그대로 있고, 성공 표시는 뜨지 않는다.
 *
 * 서버 쪽 원복은 픽스처가 증명한다 — PATCH는 저장 단계에 닿기 전에 거절되므로 서버가
 * 든 이름은 불러온 값 그대로다. 프로필이 실패하면 알림 설정 쓰기는 아예 시도되지
 * 않아야 하므로 그 횟수도 함께 센다(부분 저장 방지).
 */
test('failed profile save keeps the edited value on the settings page', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installSettingsSaveFailureFixture(page);

  await page.goto('/settings');
  const nameInput = page.locator('#settings-name');
  await expect(nameInput).toHaveValue(F3_SAVED_PROFILE.name);

  await nameInput.fill(EDITED_NAME);
  await page.getByRole('button', { name: '저장' }).click();

  // 제목만이 아니라 alert 상자 전체를 잡는다 — 그만큼을 증거 프레임에 들여야
  // 제목과 설명이 같이 남고, 읽는 사람이 무슨 실패인지까지 확인할 수 있다.
  const failureAlert = page
    .locator('[data-slot="alert"]')
    .filter({ hasText: '설정을 저장하지 못했습니다' });
  await expect(failureAlert).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(nameInput).toHaveValue(EDITED_NAME);
  await expect(page.getByText('저장되었습니다.')).toHaveCount(0);
  expect(fixture.profileWrites()).toBe(1);
  expect(fixture.notificationWrites()).toBe(0);
  expect(fixture.storedName()).toBe(F3_SAVED_PROFILE.name);

  // 앱 셸이 스크롤을 소유해(`app-frame.tsx`의 `h-dvh overflow-hidden`) 전체 페이지 캡처가
  // 뷰포트를 넘지 못한다. 그래서 무엇을 프레임에 들일지를 고른다 — 이 시나리오의
  // 일차 관찰 대상은 **실패 alert**이므로 그것을 넣는다. 보존된 입력값은 한 화면에
  // 함께 들어오지 않고(720px 뷰포트 기준 두 요소가 멀리 떨어져 있다) 위의 `toHaveValue`가
  // 이미 잠그므로 불변식으로만 남긴다.
  await failureAlert.scrollIntoViewIfNeeded();
  await captureF3Evidence(page, testInfo, 'settings-profile-save-failure');
  audit.assertClean([500]);
});
