import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLandingData } from './load-landing-data';

const program = {
  id: 'seed:program',
  name: 'Test program',
  organizer: 'Test organizer',
  trackType: null,
  applicationEndAt: '2026-11-01T00:00:00.000Z',
};
const archive = {
  projectId: 'project-1',
  programId: program.id,
  programName: program.name,
  displayName: 'Test repository',
};
const fetchMock = vi.fn<typeof fetch>();

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function respond(input: string | URL | Request): Promise<Response> {
  const url = requestUrl(input);
  const body = url.includes('projects/project-1')
    ? { projectId: 'project-1', contributors: [{ githubLogin: 'student' }] }
    : { items: url.includes('/projects?') ? [archive] : [program] };
  return Promise.resolve(Response.json(body));
}

describe('server landing data', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BACKEND_ORIGIN', 'http://127.0.0.1:4390');
    vi.stubEnv('ORIGIN_BASIC_AUTH', undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockImplementation(respond);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it('passes cache tags revalidation and timeout when fetching each public endpoint', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await loadLandingData();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(requestUrl(url)).toMatch(/^http:\/\/127\.0\.0\.1:4390\/api\/v1\//);
      expect(options).toMatchObject({
        next: { revalidate: 300, tags: ['landing'] },
      });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(timeout.mock.calls).toEqual([[2000], [2000], [2000], [2000]]);
  });

  it('returns render ready public fields when all responses parse', async () => {
    fetchMock.mockImplementation((url) => respond(url));

    const data = await loadLandingData();

    expect(data).toEqual({
      recruiting: [program],
      starPrograms: [{ name: program.name, href: '/programs/seed%3Aprogram' }],
      stats: {
        items: [
          { key: '공개 프로그램', value: '1' },
          { key: '공개 저장소', value: '1' },
          { key: '공개 기여자', value: '1' },
        ],
        note: '공개 아카이브 기준',
      },
    });
  });

  it('authenticates direct origin reads when a server credential is configured', async () => {
    vi.stubEnv('ORIGIN_BASIC_AUTH', 'Basic c3ludGhldGljOnNlcnZlcg==');

    await loadLandingData();

    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.headers).toEqual({
        Authorization: 'Basic c3ludGhldGljOnNlcnZlcg==',
      });
    }
  });

  it.each([
    ['status=recruiting', 'recruiting'],
    ['status=all', 'starPrograms'],
    ['projects?', 'stats'],
    ['projects/project-1', 'stats'],
  ] as const)('blanks only its part when %s fails', async (path, part) => {
    fetchMock.mockImplementation((url) =>
      requestUrl(url).includes(path)
        ? Promise.resolve(new Response(null, { status: 503 }))
        : respond(url),
    );

    const data = await loadLandingData();

    expect(data.recruiting).toHaveLength(part === 'recruiting' ? 0 : 1);
    expect(data.starPrograms).toHaveLength(part === 'starPrograms' ? 0 : 1);
    expect(data.stats.items).toHaveLength(part === 'stats' ? 0 : 3);
    expect(console.warn).toHaveBeenCalledWith('landing.data.unavailable', {
      part,
      error: 'ServerApiError',
    });
  });

  it('omits malformed recruiting data when a response crosses the boundary', async () => {
    fetchMock.mockImplementation((url) =>
      requestUrl(url).includes('status=recruiting')
        ? Promise.resolve(
            Response.json({ items: [{ ...program, id: '../private' }] }),
          )
        : respond(url),
    );

    const data = await loadLandingData();

    expect(data.recruiting).toEqual([]);
    expect(data.starPrograms).toHaveLength(1);
    expect(data.stats.items).toHaveLength(3);
  });

  it('omits statistics when a detail response is malformed', async () => {
    fetchMock.mockImplementation((url) =>
      requestUrl(url).includes('projects/project-1')
        ? Promise.resolve(
            Response.json({ projectId: 'project-1', contributors: null }),
          )
        : respond(url),
    );

    const data = await loadLandingData();

    expect(data.stats).toEqual({ items: [], note: null });
    expect(data.recruiting).toHaveLength(1);
  });
});
