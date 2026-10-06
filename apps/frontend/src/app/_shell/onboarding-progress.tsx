export const ONBOARDING_STEPS = [
  '약관 동의',
  '역할 선택',
  '프로필 입력',
] as const;

export type OnboardingStep = 1 | 2 | 3;

export function OnboardingProgress({ current }: { current?: OnboardingStep }) {
  const total = ONBOARDING_STEPS.length;

  return (
    <nav
      aria-label="가입 진행 단계"

      className="relative z-10 flex w-16 flex-none flex-col items-center justify-center gap-2 sm:w-24"
    >
      <p className="sr-only">
        {current === undefined
          ? `가입은 ${total}단계입니다. ${ONBOARDING_STEPS.join(', ')} 순서로 진행합니다.`
          : `${total}단계 중 ${current}단계 · ${ONBOARDING_STEPS[current - 1]}`}
      </p>

      <ol className="flex flex-col items-center gap-2" role="list">
        {ONBOARDING_STEPS.map((label, index) => {
          const step = index + 1;
          const isDone = current !== undefined && step < current;
          const isCurrent = current !== undefined && step === current;

          return (
            <li key={label} aria-current={isCurrent ? 'step' : undefined}>
              <span
                aria-hidden="true"
                className={`block w-0.5 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                  isCurrent
                    ? 'h-[30px] bg-cosmos-copy'
                    : isDone
                      ? 'h-[22px] bg-cosmos-copy/55'
                      : 'h-[22px] bg-cosmos-muted/25'
                }`}
              />
              <span className="sr-only">
                {label}

                {isDone ? ' 완료' : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
