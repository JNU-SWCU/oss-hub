/**
 * 가입을 마치지 않은 사용자가 설정을 열었을 때, 온보딩으로 되돌리기 직전에
 * 설정 자리에 잠깐 띄우는 안내.
 *
 * 아무 말 없이 화면만 바뀌면 사용자는 자기가 무엇을 잘못했는지 모른 채 설정을
 * 다시 누른다. 그래서 "권한이 없습니다" 같은 판정문 대신 다음에 할 일을 적는다.
 */
export const SETTINGS_ONBOARDING_NOTICE_HEADING = '가입을 먼저 끝내주세요';
export const SETTINGS_ONBOARDING_NOTICE_BODY =
  '설정은 가입을 마친 뒤에 사용할 수 있습니다. 남은 가입 단계로 이동합니다.';

export function SettingsOnboardingNotice() {
  return (
    <section
      aria-labelledby="settings-onboarding-notice-heading"
      className="flex flex-col items-start gap-2 p-6"
      role="status"
      aria-live="polite"
    >
      <h1
        id="settings-onboarding-notice-heading"
        className="text-lg font-semibold text-foreground"
      >
        {SETTINGS_ONBOARDING_NOTICE_HEADING}
      </h1>
      <p className="break-keep text-sm text-muted-foreground">
        {SETTINGS_ONBOARDING_NOTICE_BODY}
      </p>
    </section>
  );
}
