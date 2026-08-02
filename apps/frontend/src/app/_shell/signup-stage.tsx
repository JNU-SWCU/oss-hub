import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { OnboardingProgress, type OnboardingStep } from './onboarding-progress';

/**
 * 가입 동선 네 화면(`/signup` · `/consent` · `/onboarding/role` · `/onboarding/profile`)의
 * 바깥 틀.
 *
 * 회원가입의 정의가 바뀌면서 생긴 틀이다 — **GitHub 연결만으로는 가입이 아니고,
 * 프로필 입력까지 마쳐야 회원이다.** GitHub만 연결한 사람은 가입 화면이 궁금해서
 * 들어와 본 사람일 수 있다. 그래서 가입을 마치기 전까지는 랜딩과 같은 우주 바탕에
 * 머무르고, 프로필을 저장하는 순간 순백 업무 화면으로 넘어간다. 화면이 바뀌는 것
 * 자체가 "이제 회원이 되었다"는 신호다.
 *
 * 랜딩의 canvas 여정을 그대로 끌어오지는 않는다. 그 캔버스는 스크롤을 따라
 * 이야기를 진행시키는 장치인데 가입 폼에는 진행시킬 이야기가 없다. 가족처럼
 * 보이게 하는 것은 바탕색·글자 위계·알약 배지·흰 주 버튼·왼쪽 세로 진행 바이고,
 * 그것만 가져온다.
 *
 * `data-surface="inverted"`가 핵심이다. 이 스코프 안에서는 shadcn 부품(Button ·
 * Input · Checkbox · Alert)이 어두운 바탕 기준으로 다시 색칠된다. 화면마다 색을
 * 직접 칠하면 대비가 갈라지므로 여기서 한 번만 선언한다 — 그 토큰들은 #275가
 * 히어로 위에서 대비를 이미 검증했다.
 */
export function SignupStage({
  step,
  children,
  className,
}: {
  /** 3단계 중 몇 번째인가. `/signup`은 아직 단계 밖이라 넘기지 않는다. */
  readonly step?: OnboardingStep;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-surface="inverted"
      className={cn(
        // 바탕색과 높이는 `AppFrame`이 준다 — 거기서 헤더와 본문을 세로 flex로
        // 나눠 두었으므로 남은 높이를 그대로 채우면 된다. 헤더 높이를 숫자로 빼면
        // 좁은 폭에서 헤더가 한 줄 늘어날 때 그만큼 스크롤이 남는다.
        'relative flex w-full flex-1',
        className,
      )}
    >
      {/* 랜딩 성단의 초록 광원을 한 겹만 흉내낸다 — 별을 그리지 않아도 바탕이
          검정 단색으로 죽지 않는다. 장식이므로 스크린 리더에서 감춘다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60rem 40rem at 78% 38%, color-mix(in oklch, var(--cosmos-repository) 13%, transparent), transparent 70%)',
        }}
      />

      <OnboardingProgress current={step} />

      {/* 본문은 기둥 하나만 쓴다. 예전에는 진행 표시가 가로 막대라 본문과 좌우
          여백이 서로 달라 시작 위치가 32px 어긋났다 — 진행 표시가 세로로 나가면
          어긋날 자리 자체가 없어진다. */}
      <main
        id="signup-main"
        className="relative z-10 flex w-full max-w-2xl flex-col justify-center gap-8 py-16 pr-6 sm:pr-12"
      >
        {children}
      </main>
    </div>
  );
}

/*
 * 글자 위계(`SignupEyebrow`·`SignupTitle`·`SignupLede`)와 주 버튼 색
 * (`signupPrimaryClassName`)은 `components/signup-typography.tsx`에 있다.
 * `features` 안 화면들도 그것들을 써야 하는데 `features`는 `app`을 import할 수
 * 없기 때문이다(app → features → lib 단방향). 무대는 화면을 조립하는 일이라
 * app에 남는다 — 그래서 각 페이지가 자기 화면을 이 무대로 감싼다.
 */
