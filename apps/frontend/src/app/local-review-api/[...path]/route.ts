import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiPath } from '@/lib/api-client';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  isLocalReviewRuntime,
  isLoopbackHostname,
  parseLocalReviewFixture,
  parseRequestHostname,
} from '@/lib/local-review-runtime';
import { canonicalLocalReviewSessionBody } from '@/lib/local-review-session';

type RouteContext = {
  readonly params: Promise<{ readonly path: readonly string[] }>;
};

/**
 * 응답 규칙이 승인·반려를 구분하려면 요청 본문이 필요하다.
 * 본문이 없는 요청(GET·DELETE)과 JSON이 아닌 본문은 모두 `undefined`로 두고,
 * 여기서 던지지 않는다 — 파싱 실패가 500이 되면 검토자는 화면이 깨진 것으로 본다.
 */
async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    const raw = await request.text();
    if (raw.trim() === '') return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function handle(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const backendOrigin = (
    process.env.BACKEND_ORIGIN ?? 'http://localhost:4000'
  ).replace(/\/$/, '');
  const fixture = parseLocalReviewFixture(
    request.cookies.get(LOCAL_REVIEW_FIXTURE_COOKIE)?.value ?? null,
  );
  if (
    fixture === null ||
    !isLoopbackHostname(
      parseRequestHostname(request.headers.get('host')) ?? '',
    ) ||
    !isLocalReviewRuntime({
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.OSS_HUB_LOCAL_REVIEW_FIXTURES,
      backendOrigin,
    })
  ) {
    return new Response(null, { status: 404 });
  }

  const { resolveLocalReviewResponse } =
    await import('../../../../test-support/local-review/fixture-response');
  const { path } = await context.params;
  const fixturePath = path.join('/');
  const plan = resolveLocalReviewResponse({
    fixture,
    // Next는 HEAD를 GET 핸들러로 넘기면서 method는 'HEAD'로 남긴다. 그대로 두면
    // GET 규칙이 전부 빗나가 모든 경로가 404가 된다 — 응답 본문은 어차피
    // 버려지므로 GET과 같은 규칙을 태운다.
    method: request.method === 'HEAD' ? 'GET' : request.method,
    path: fixturePath,
    searchParams: request.nextUrl.searchParams,
    body: await readJsonBody(request),
  });

  // 링크로 전체 이동해 온 요청(로그인 시작 경로 등)은 화면으로 되돌려 보낸다.
  // JSON을 주면 브라우저가 그 JSON을 그대로 렌더해 검토 동선이 거기서 끊긴다.
  //
  // Location은 규칙이 준 값을 그대로 둔다. `NextResponse.redirect(new URL(location,
  // request.url))`은 절대 URL을 만드는데, dev 서버에서 `request.url`의 host는 실제
  // Host 헤더가 아니라 localhost로 정규화된다. 그래서 127.0.0.1로 진입한 검토자가
  // `Location: http://localhost:3100/...`을 받아 다른 출처로 튕겼고, 픽스처 쿠키는
  // host-only로 127.0.0.1에만 심겨 있어 다음 요청에 실려 가지 않았다 — 세션이 끊긴
  // 화면을 기다리다 동선이 timeout으로 죽었다. 상대 Location은 브라우저가 요청 URL을
  // 기준으로 해석하므로 진입 host가 끝까지 남는다. 활성화 경로(`local-review/[fixture]`)가
  // 같은 이유로 이미 이렇게 답하고 있어 두 경로의 답이 어긋나지 않는다.
  //
  // `plan.location`은 규칙이 정한 상수이고 계약상 `/`로 시작하는 앱 내부 경로만 온다
  // (`handler-kit`의 redirect 주석). 요청 값이 섞이지 않으니 다른 origin으로 샐 여지가
  // 없고, 혹시 절대 URL이 오더라도 그대로 내보내는 편이 host를 덮어쓰지 않아 안전하다.
  if (plan.kind === 'redirect') {
    const response = new NextResponse(null, {
      status: plan.status,
      headers: { Location: plan.location },
    });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-OSS-Hub-Local-Fixture', fixture);
    return response;
  }

  if (plan.kind === 'delay') {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, plan.milliseconds);
    });
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Local review fixture timeout',
        status: 504,
        detail: 'The loading fixture reached its bounded timeout.',
        instance: apiPath('auth/session'),
        code: 'LFX_504',
      },
      { status: 504 },
    );
  }

  return NextResponse.json(
    canonicalLocalReviewSessionBody(fixturePath, plan.body),
    {
      status: plan.status,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-OSS-Hub-Local-Fixture': fixture,
      },
    },
  );
}

export function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  return handle(request, context);
}

export function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  return handle(request, context);
}

export function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  return handle(request, context);
}

/**
 * 마일스톤 삭제는 DELETE로 나간다. export가 없으면 Next가 라우트 파일 단계에서
 * 405를 돌려줘 픽스처 규칙까지 도달하지도 못한다 — 같은 `handle`을 재사용해
 * 로컬호스트·development·픽스처 쿠키 가드를 그대로 통과시킨다.
 */
export function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  return handle(request, context);
}
