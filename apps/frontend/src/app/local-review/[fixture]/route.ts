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

  const response = NextResponse.redirect(
    new URL(activation.target, request.url),
    303,
  );
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
