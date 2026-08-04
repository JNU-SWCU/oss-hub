import { Fragment } from 'react';

/**
 * 승인을 기다리는 교직원이 설정을 열었을 때 화면 맨 위에 서는 안내.
 *
 * 예전에는 온보딩으로 되돌리기 직전에 잠깐 스치는 화면이었다. 지금은 되돌리지 않고
 * 설정을 그대로 열어 주므로(#581), 이 안내가 하는 일도 바뀌었다 — "곧 나갑니다"가
 * 아니라 "가입은 아직 남았지만 여기까지는 됩니다"를 말한다.
 *
 * 문구 규칙 셋을 지킨다.
 *
 * 1. "권한이 없습니다" 같은 판정문 대신 지금 할 수 있는 일을 적는다.
 * 2. **학번은 "고친다"고 하지 않는다.** 같은 화면의 입력란이 "한 번 저장하면 변경할
 *    수 없습니다"라고 말하는데 안내가 고칠 수 있다고 하면, 저장된 학번을 고치러 들어온
 *    사용자는 잠긴 칸을 보고 고장으로 읽는다. 처음 한 번 채우는 것뿐임을 문장에 담는다.
 * 3. **`~할 수 있습니다`를 쓰지 않는다.** 375px에서 이 구절이 `고칠 수` / `있습니다`로
 *    갈라졌다. `수`는 홀로 설 수 없는 의존명사라 줄이 바뀌면 문장이 끊겨 읽힌다.
 */
export const SETTINGS_ONBOARDING_NOTICE_HEADING = '가입이 아직 진행 중입니다';

/**
 * 안내 본문을 문장 단위로 나눠 둔다. 줄이 바뀌는 자리를 문장 경계로 고정하기 위해서다.
 *
 * `break-keep`은 어절 안쪽만 막을 뿐 어절 사이 띄어쓰기에서는 줄을 바꾼다. 그래서 한
 * 덩어리 문단으로 두면 폭에 따라 `한 번만` / `입력합니다`처럼 문장 한가운데가 갈리고,
 * 어느 문구로 바꿔도 폭이 조금만 달라지면 다른 자리에서 같은 일이 난다 — 375px에서
 * 실제로 신고된 증상(`고칠 수` / `있습니다`)이 그것이다.
 *
 * 문장 하나를 `inline-block` 한 상자로 만들면, 남은 자리에 못 들어가는 상자는 문장
 * 중간에서 갈리는 대신 통째로 다음 줄로 내려간다. 상자보다 줄이 좁을 때만 안쪽에서
 * 갈리는데, 375px 기준 한 문장은 226px이고 안내 폭은 325px이라 그 경우가 없다. 넓은
 * 화면에서는 세 상자가 한 줄에 모두 들어가 종전처럼 한 문단으로 읽힌다.
 */
export const SETTINGS_ONBOARDING_NOTICE_SENTENCES = [
  '승인 전에도 이름·학과 수정은 가능합니다.',
  '학번은 처음 한 번만 입력합니다.',
  '나머지 기능은 가입 후 열립니다.',
] as const;

export const SETTINGS_ONBOARDING_NOTICE_BODY =
  SETTINGS_ONBOARDING_NOTICE_SENTENCES.join(' ');

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
        {SETTINGS_ONBOARDING_NOTICE_SENTENCES.map((sentence, index) => (
          <Fragment key={sentence}>
            {/* 상자 사이의 진짜 공백이 곧 줄바꿈 자리다 — 없애면 갈라질 곳이 없어
                세 문장이 한 줄에 붙은 채 넘친다. */}
            {index === 0 ? null : ' '}
            <span className="inline-block">{sentence}</span>
          </Fragment>
        ))}
      </p>
    </section>
  );
}
