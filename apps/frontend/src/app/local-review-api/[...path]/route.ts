import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiPath } from '@/lib/api-client';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  isLocalReviewRuntime,
  isLoopbackHostname,
  parseLocalReviewFixture,
  parseRequestHostname,
} from '../../_local-review/fixture-contract';
import { resolveLocalReviewResponse } from '../../_local-review/fixture-response';

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

  const { path } = await context.params;
  const plan = resolveLocalReviewResponse({
    fixture,
    // Next는 HEAD를 GET 핸들러로 넘기면서 method는 'HEAD'로 남긴다. 그대로 두면
    // GET 규칙이 전부 빗나가 모든 경로가 404가 된다 — 응답 본문은 어차피
    // 버려지므로 GET과 같은 규칙을 태운다.
    method: request.method === 'HEAD' ? 'GET' : request.method,
    path: path.join('/'),
    searchParams: request.nextUrl.searchParams,
    body: await readJsonBody(request),
  });

  // 링크로 전체 이동해 온 요청(로그인 시작 경로 등)은 화면으로 되돌려 보낸다.
  // JSON을 주면 브라우저가 그 JSON을 그대로 렌더해 검토 동선이 거기서 끊긴다.
  if (plan.kind === 'redirect') {
    const response = NextResponse.redirect(
      new URL(plan.location, request.url),
      plan.status,
    );
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

  return NextResponse.json(plan.body, {
    status: plan.status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-OSS-Hub-Local-Fixture': fixture,
    },
  });
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
