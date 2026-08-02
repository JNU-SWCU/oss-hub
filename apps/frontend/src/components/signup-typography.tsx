import type { ReactNode } from 'react';

/**
 * 가입 동선 네 화면(`/signup` · `/consent` · `/onboarding/role` ·
 * `/onboarding/profile`)이 함께 쓰는 글자 위계와 주 버튼 색.
 *
 * 화면마다 크기를 직접 적으면 같은 동선 안에서 제목 크기가 화면마다 달라진다 —
 * 사용자는 그 흔들림을 "정리되지 않았다"로 읽는다. 값은 랜딩 히어로에서 그대로
 * 가져왔다(알약 12px/600 자간 넓게 · 제목 굵게 자간 좁게 · 본문 흐린 남보라).
 *
 * 무대(`app/_shell/signup-stage.tsx`)가 아니라 여기 `components/`에 있는 이유는
 * 계층 규칙이다 — `features`는 `app`을 import할 수 없다(app → features → lib
 * 단방향). 무대는 화면을 조립하는 일이라 app에 남고, 글자 위계는 features 안
 * 화면들도 써야 하므로 공용 표현 계층으로 내려왔다.
 */
export function SignupEyebrow({ children }: { readonly children: ReactNode }) {
  return (
    <span className="w-fit rounded-full border border-cosmos-border bg-cosmos-muted/8 px-3.5 py-1.5 text-xs font-semibold tracking-[0.08em] text-cosmos-muted">
      {children}
    </span>
  );
}

export function SignupTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="font-heading text-3xl leading-tight font-extrabold tracking-tight text-balance text-cosmos-copy sm:text-4xl">
      {children}
    </h1>
  );
}

export function SignupLede({ children }: { readonly children: ReactNode }) {
  return (
    <p className="max-w-prose text-body break-keep text-cosmos-muted">
      {children}
    </p>
  );
}

/**
 * 이 무대 위 주 버튼(랜딩과 같은 흰 바탕 + 남색 글자)에 붙이는 클래스.
 *
 * 랜딩은 같은 모양을 `bg-background text-primary`로 만드는데, 그 코드는 반전
 * 스코프 **밖**에 있어 `--background`가 흰색이다. 가입 무대는 안쪽이라 같은
 * 유틸리티가 투명이 되어 버린다(실제로 버튼이 사라졌다). 그래서 흰색을
 * `--cosmos-copy`로 직접 가리킨다 — 랜딩과 같은 값을 같은 팔레트에서 읽는 것이라
 * 둘이 갈라지지 않는다.
 */
export const signupPrimaryClassName =
  'bg-cosmos-copy text-primary hover:bg-cosmos-copy/90';
