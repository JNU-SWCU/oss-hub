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
    method: request.method,
    path: path.join('/'),
    searchParams: request.nextUrl.searchParams,
  });

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
