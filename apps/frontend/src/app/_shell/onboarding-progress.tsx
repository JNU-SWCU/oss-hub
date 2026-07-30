/**
 * 온보딩 진행 단계 표시.
 *
 * 로그인 직후 동의·프로필·역할 선택이 연속 세 폼으로 이어진다. 끝이 보이지
 * 않으면 사용자는 중간에 그만두고, 실제로 역할이 비어 있는 계정이 남았다.
 * 남은 단계를 눈에 보이게 만드는 것이 이 표시의 목적이다.
 *
 * 승인 대기(`/onboarding/pending`)는 단계가 아니라 역할 선택의 결과이므로
 * 여기에 넣지 않는다 — 사용자가 진행해서 통과하는 화면이 아니다.
 */
export const ONBOARDING_STEPS = [
  '약관 동의',
  '프로필 입력',
  '역할 선택',
] as const;

export type OnboardingStep = 1 | 2 | 3;

export function OnboardingProgress({ current }: { current: OnboardingStep }) {
  const total = ONBOARDING_STEPS.length;

  return (
    <nav
      aria-label="가입 진행 단계"
      className="mx-auto w-full max-w-2xl px-4 pt-6"
    >
      {/* 숫자를 문장으로도 제공한다 — 점·선만으로는 몇 단계가 남았는지 읽히지 않고,
          스크린 리더에서는 목록 구조보다 이 한 줄이 먼저 필요하다. */}
      <p className="text-sm font-medium text-muted-foreground">
        {total}단계 중 {current}단계 · {ONBOARDING_STEPS[current - 1]}
      </p>

      <ol className="mt-2 flex gap-2" role="list">
        {ONBOARDING_STEPS.map((label, index) => {
          const step = index + 1;
          const isDone = step < current;
          const isCurrent = step === current;

          return (
            <li
              key={label}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex-1"
            >
              <span
                aria-hidden="true"
                className={`block h-1 rounded-full ${
                  isDone || isCurrent ? 'bg-primary' : 'bg-border'
                }`}
              />
              <span
                className={`mt-1.5 block text-xs ${
                  isCurrent
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {label}
                {/* 색만으로 완료를 구분하지 않는다 — 색각 이상 사용자에게는 전달되지 않는다 */}
                {isDone ? <span className="sr-only"> 완료</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
