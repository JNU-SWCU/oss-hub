import { afterEach, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: vi.fn((work: () => Promise<unknown>) => work),
}));
vi.mock('../../backend-origin', () => ({
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
  };
}

afterEach(() => {
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
