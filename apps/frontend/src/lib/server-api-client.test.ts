import { afterEach, expect, it, vi } from 'vitest';
import * as originConfig from '../../backend-origin';
import { serverApiClient } from './server-api-client';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reuses the validated origin when concurrent public requests arrive', async () => {
  const origin = vi
    .spyOn(originConfig, 'backendOrigin')
    .mockReturnValue('https://approved.example');
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
  vi.stubGlobal('fetch', fetchMock);
  const cache = { revalidate: 300, tags: ['landing'] };

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

it('rejects after the deadline even when the request ignores its abort signal', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
  );

  const request = serverApiClient('programs', {
    revalidate: 300,
    tags: ['landing'],
  });
  const settled = expect(request).rejects.toMatchObject({
    name: 'ServerApiTimeoutError',
  });
  await vi.advanceTimersByTimeAsync(2000);

  await settled;
});
