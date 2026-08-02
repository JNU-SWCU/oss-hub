/**
 * 온보딩 진행 단계 표시.
 *
 * 로그인 직후 동의·역할 선택·프로필이 연속 세 폼으로 이어진다. 끝이 보이지
 * 않으면 사용자는 중간에 그만두고, 실제로 역할이 비어 있는 계정이 남았다.
 * 남은 단계를 눈에 보이게 만드는 것이 이 표시의 목적이다.
 *
 * 승인 대기(`/onboarding/pending`)는 단계가 아니라 역할 선택의 결과이므로
 * 여기에 넣지 않는다 — 사용자가 진행해서 통과하는 화면이 아니다.
 *
 * 역할이 프로필보다 앞이다. 프로필을 먼저 받으면 그 화면이 역할을 몰라 학생
 * 기준(가장 엄격)으로 판정하고, 학번이 필요 없는 교직원·관리자가 가짜 학번을
 * 지어내야 다음 단계로 갈 수 있다.
 *
 * 모양은 랜딩의 여정 진행 바와 같다 — 화면 왼쪽에 세로로 선 눈금이고, 현재
 * 단계만 밝고 길다(`landing-journey.module.css`의 `.tick`/`.tickOn`과 같은
 * 치수·색을 쓴다). 가로 막대에서 세로 눈금으로 옮긴 이유가 둘이다.
 * 하나는 랜딩에서 가입으로 넘어올 때 같은 장치가 이어져 화면이 끊기지 않는 것,
 * 다른 하나는 본문 위에 가로로 눕지 않으니 본문과 좌우 여백을 맞출 필요가
 * 없어지는 것이다 — 예전에는 그 여백이 서로 달라 본문 시작 위치가 32px 어긋났다.
 */
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
      /* 본문이 세로 가운데 정렬이므로 눈금도 가운데에 둔다 — 위에 붙이면 본문과
         높이가 어긋나 화면 구석에 떠 있는 조각처럼 보인다. */
      className="relative z-10 flex w-16 flex-none flex-col items-center justify-center gap-2 sm:w-24"
    >
      {/* 숫자를 문장으로도 제공한다 — 눈금만으로는 몇 단계가 남았는지 읽히지 않고,
          스크린 리더에서는 목록 구조보다 이 한 줄이 먼저 필요하다. 눈금은 폭이
          2px라 이 문장을 곁에 둘 자리가 없으므로 화면에서는 감추고 이름만 남긴다.
          `/signup`은 아직 단계 밖이라 현재 단계가 없다. */}
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
              {/* 눈금은 장식이다. 단계 이름은 아래 sr-only가 들고 있으므로
                  여기서 다시 읽히면 같은 말이 두 번 나온다. */}
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
                {/* 색·길이만으로 완료를 구분하지 않는다 — 색각 이상 사용자와
                    스크린 리더 양쪽에 전달되지 않는다. */}
                {isDone ? ' 완료' : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
