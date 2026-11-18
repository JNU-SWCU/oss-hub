import { fetchProgramCover } from '@/lib/server-api-client';

const coverIdSegment = /^[A-Za-z0-9_-]{1,128}$/;
const errorHeaders = { 'Cache-Control': 'no-store' };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ programId: string; coverId: string }> },
): Promise<Response> {
  const { programId, coverId } = await params;
  if (
    new URL(request.url).search ||
    !coverIdSegment.test(programId) ||
    !coverIdSegment.test(coverId)
  ) {
    return new Response(null, { status: 404, headers: errorHeaders });
  }

  try {
    const upstream = await fetchProgramCover(programId, coverId);
    const contentType = upstream.headers.get('content-type');
    if (
      upstream.status === 200 &&
      upstream.body &&
      (contentType === 'image/png' || contentType === 'image/jpeg')
    ) {
      return new Response(upstream.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': upstream.headers.get('cache-control') ?? 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    await upstream.body?.cancel();
    return new Response(null, {
      status: upstream.status === 404 ? 404 : 502,
      headers: errorHeaders,
    });
  } catch {
    return new Response(null, { status: 502, headers: errorHeaders });
  }
}
