import { afterEach, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: vi.fn((work: () => Promise<unknown>) => work),
}));
vi.mock('../../backend-origin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../backend-origin')>()),
  backendOrigin: vi.fn(() => 'https://approved.example'),
}));

async function freshClient() {
  vi.resetModules();
  const cacheModule = await import('next/cache');
  const originModule = await import('../../backend-origin');
  const clientModule = await import('./server-api-client');
  return {
    unstableCache: vi.mocked(cacheModule.unstable_cache),
    backendOrigin: vi.mocked(originModule.backendOrigin),
    serverApiClient: clientModule.serverApiClient,
    fetchProgramCover: clientModule.fetchProgramCover,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cache = { revalidate: 300, tags: ['landing'] };

it('reuses the validated origin when concurrent public requests arrive', async () => {
  const { backendOrigin, serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await Promise.all([
    serverApiClient('programs', cache),
    serverApiClient('projects', cache),
  ]);

  expect(backendOrigin).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://approved.example/api/v1/programs',
    'https://approved.example/api/v1/projects',
  ]);
});

it('caches through unstable_cache while every origin read bypasses the fetch cache', async () => {
  const { unstableCache, serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs', cache);

  expect(unstableCache).toHaveBeenCalledWith(
    expect.any(Function),
    ['server-api', 'https://approved.example/api/v1/programs'],
    { revalidate: 300, tags: ['landing'] },
  );
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
});

it('can read the public catalog without storing a search in the shared cache', async () => {
  const { unstableCache, serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ items: [], totalPages: 0 }),
    );
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs?search=synthetic');

  expect(unstableCache).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe('https://approved.example/api/v1/programs?search=synthetic');
  expect(options?.cache).toBe('no-store');
  expect(options?.headers).toBeUndefined();
});

it('aborts the origin read at the deadline', async () => {
  const { serverApiClient } = await freshClient();
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        });
      }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const request = serverApiClient('programs', cache);
  const settled = expect(request).rejects.toMatchObject({
    name: 'ServerApiTimeoutError',
  });
  await vi.advanceTimersByTimeAsync(2000);

  await settled;
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('rejects at the deadline even when the request ignores its abort signal', async () => {
  const { serverApiClient } = await freshClient();
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
  );

  const request = serverApiClient('programs', cache);
  const settled = expect(request).rejects.toMatchObject({
    name: 'ServerApiTimeoutError',
  });
  await vi.advanceTimersByTimeAsync(2000);

  await settled;
});

it('goes through the production site so the origin gate sees a Vercel request', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'jnu-oss-hub.com');
  vi.stubEnv('ORIGIN_BASIC_AUTH', 'Basic secret');
  const { backendOrigin, serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs', cache);

  expect(backendOrigin).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://jnu-oss-hub.com/api/v1/programs',
  );
  expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('headers');
});

it('reads the validated backend origin with its credential outside Vercel production', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'jnu-oss-hub.com');
  vi.stubEnv('ORIGIN_BASIC_AUTH', 'Basic secret');
  const { backendOrigin, serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs', cache);

  expect(backendOrigin).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://approved.example/api/v1/programs',
  );
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: 'Basic secret' },
  });
});

it('ignores a production host that is not a plain hostname', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'evil.example/path?x=');
  const { serverApiClient } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs', cache);

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://approved.example/api/v1/programs',
  );
});

const coverCredential = `Basic ${Buffer.from(`vercel:${'x'.repeat(32)}`).toString('base64')}`;

it('fetches cover bytes through the trusted production rewrite without a function credential or retry', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '  APP.EXAMPLE.TEST  ');
  vi.stubEnv('ORIGIN_BASIC_AUTH', coverCredential);
  const { backendOrigin, fetchProgramCover } = await freshClient();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetchMock);

  const response = await fetchProgramCover('program', 'cover');

  expect(response.status).toBe(403);
  expect(backendOrigin).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe(
    'https://app.example.test/api/v1/programs/program/cover/cover',
  );
  expect(init).toMatchObject({ cache: 'no-store', redirect: 'manual' });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init).not.toHaveProperty('headers');
});

it.each([
  ['preview', 'app.example.test'],
  ['production', 'app.example.test/untrusted'],
])(
  'fetches cover bytes with Basic auth at the validated origin for %s with host %s',
  async (environment, host) => {
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', host);
    vi.stubEnv('ORIGIN_BASIC_AUTH', coverCredential);
    const { backendOrigin, fetchProgramCover } = await freshClient();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);

    await fetchProgramCover('program', 'cover');

    expect(backendOrigin).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://approved.example/api/v1/programs/program/cover/cover',
    );
    expect(init?.headers).toEqual({ Authorization: coverCredential });
  },
);
