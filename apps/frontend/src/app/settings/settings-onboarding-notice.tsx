/**
 * 가입을 마치지 않은 사용자가 설정을 열었을 때 화면 맨 위에 서는 안내.
 *
 * 예전에는 온보딩으로 되돌리기 직전에 잠깐 스치는 화면이었다. 지금은 되돌리지 않고
 * 설정을 그대로 열어 주므로(#581), 이 안내가 하는 일도 바뀌었다 — "곧 나갑니다"가
 * 아니라 "가입은 아직 남았지만 여기서 고칠 수 있습니다"를 말한다.
 *
 * "권한이 없습니다" 같은 판정문 대신 지금 할 수 있는 일을 적는 규칙은 그대로다.
 */
export const SETTINGS_ONBOARDING_NOTICE_HEADING = '가입이 아직 진행 중입니다';
export const SETTINGS_ONBOARDING_NOTICE_BODY =
  '승인을 기다리는 동안에도 이름·학과·학번은 여기서 고칠 수 있습니다. 나머지 기능은 가입을 마치면 열립니다.';

export function SettingsOnboardingNotice() {
  return (
    // 본문(`PageBody`)이 max-w-2xl이라 안내도 같은 폭으로 세운다 — 폭이 어긋나면
    // 안내가 본문에 딸린 말이 아니라 다른 화면 조각으로 읽힌다.
    <section
      aria-labelledby="settings-onboarding-notice-heading"
      className="mx-auto mt-8 flex w-full max-w-2xl flex-col items-start gap-2 rounded-card border border-border bg-card px-6 py-4 sm:mt-16"
      role="status"
      aria-live="polite"
    >
      {/* 본문의 `h1`("설정")이 이미 페이지 제목이라 여기서는 한 칸 내린다. */}
      <h2
        id="settings-onboarding-notice-heading"
        className="text-base font-semibold text-foreground"
      >
        {SETTINGS_ONBOARDING_NOTICE_HEADING}
      </h2>
      <p className="break-keep text-sm text-muted-foreground">
        {SETTINGS_ONBOARDING_NOTICE_BODY}
      </p>
    </section>
  );
}
