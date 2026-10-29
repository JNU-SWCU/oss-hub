import { unstable_cache } from 'next/cache';
import { afterEach, expect, it, vi } from 'vitest';
import * as originConfig from '../../backend-origin';
import { serverApiClient } from './server-api-client';

vi.mock('next/cache', () => ({
  unstable_cache: vi.fn((work: () => Promise<unknown>) => work),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(unstable_cache).mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cache = { revalidate: 300, tags: ['landing'] };

it('reuses the validated origin when concurrent public requests arrive', async () => {
  const origin = vi
    .spyOn(originConfig, 'backendOrigin')
    .mockReturnValue('https://approved.example');
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await Promise.all([
    serverApiClient('programs', cache),
    serverApiClient('projects', cache),
  ]);

  expect(origin).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://approved.example/api/v1/programs',
    'https://approved.example/api/v1/projects',
  ]);
});

it('caches through unstable_cache while every origin read bypasses the fetch cache', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);

  await serverApiClient('programs', cache);

  expect(unstable_cache).toHaveBeenCalledWith(
    expect.any(Function),
    ['server-api', 'https://approved.example/api/v1/programs'],
    { revalidate: 300, tags: ['landing'] },
  );
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
});

it('aborts the origin read at the deadline', async () => {
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
