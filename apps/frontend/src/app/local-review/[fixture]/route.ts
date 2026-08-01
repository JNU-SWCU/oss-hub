import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  createLocalReviewActivation,
  parseRequestHostname,
} from '../../_local-review/fixture-contract';

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

  // Location을 상대 경로로 둬서 진입한 host를 그대로 유지한다. NextResponse.redirect()는
  // 절대 URL을 요구하는데, dev 서버에서 request.url의 host는 실제 Host 헤더가 아니라
  // localhost로 정규화된다. 그래서 127.0.0.1로 진입하면 fixture cookie는 host-only로
  // 127.0.0.1에 심기고 Location만 localhost로 바뀌어, 브라우저가 다음 요청에 cookie를
  // 보내지 않아 하네스가 조용히 꺼진 것처럼 보였다. 상대 Location은 브라우저가 요청 URL을
  // 기준으로 해석하므로 entry host가 끝까지 남는다 — activation.target은 이미 allowlist된
  // `/`로 시작하는 경로라 다른 origin으로 샐 여지가 없다.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: activation.target },
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
