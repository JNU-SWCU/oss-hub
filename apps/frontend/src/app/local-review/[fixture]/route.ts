import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  createLocalReviewActivation,
  parseRequestHostname,
} from '@/lib/local-review-runtime';

type RouteContext = {
  readonly params: Promise<{ readonly fixture: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { fixture: fixtureParam } = await context.params;
  const backendOrigin = (
    process.env.BACKEND_ORIGIN ?? 'http://localhost:4000'
  ).replace(/\/$/, '');
  const activation = createLocalReviewActivation({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.OSS_HUB_LOCAL_REVIEW_FIXTURES,
    backendOrigin,
    requestHostname: parseRequestHostname(request.headers.get('host')) ?? '',
    fixtureParam,
    targetParam: request.nextUrl.searchParams.get('to'),
  });

  if (activation.kind === 'not-found') {
    return new Response(null, { status: 404 });
  }

  const { resetLocalReviewRoleSelection } =
    await import('../../../../test-support/local-review/handlers/account-handlers');

  // 이 경로는 검토판의 링크를 눌러 "이 페르소나로 여기서 시작한다"고 말하는 자리다.
  // 그래서 앞선 검토가 남긴 역할 선택·프로필 입력을 여기서 지운다. 지우지 않으면 한 번
  // 걸어 본 가입 동선을 다시 볼 수 없다 — 교직원을 고른 뒤에는 `role-requests/me`가
  // 계속 `PENDING`이라 역할 선택 화면이 승인 대기로 튕기고, 학생을 고른 뒤에는 세션이
  // 배정 상태라 온보딩 화면 전체가 역할 홈으로 빠져나간다. 서버를 다시 띄우는 것 말고는
  // 되돌릴 방법이 없었고, 검토자는 그것을 제품 결함으로 읽는다.
  resetLocalReviewRoleSelection();

  // Location을 상대 경로로 둬서 진입한 host를 그대로 유지한다. NextResponse.redirect()는
  // 절대 URL을 요구하는데, dev 서버에서 request.url의 host는 실제 Host 헤더가 아니라
  // localhost로 정규화된다. 그래서 127.0.0.1로 진입하면 fixture cookie는 host-only로
  // 127.0.0.1에 심기고 Location만 localhost로 바뀌어, 브라우저가 다음 요청에 cookie를
  // 보내지 않아 하네스가 조용히 꺼진 것처럼 보였다. 상대 Location은 브라우저가 요청 URL을
  // 기준으로 해석하므로 entry host가 끝까지 남는다 — activation.target은 이미 allowlist된
  // `/`로 시작하는 경로라 다른 origin으로 샐 여지가 없다.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: relativeLocation(activation.target) },
  });
  if (activation.fixture === null) {
    response.cookies.delete(LOCAL_REVIEW_FIXTURE_COOKIE);
  } else {
    response.cookies.set(LOCAL_REVIEW_FIXTURE_COOKIE, activation.fixture, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/',
      maxAge: 8 * 60 * 60,
    });
  }
  return response;
}

function relativeLocation(target: string): string {
  const parsed = new URL(target, 'http://local-review.invalid');
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
