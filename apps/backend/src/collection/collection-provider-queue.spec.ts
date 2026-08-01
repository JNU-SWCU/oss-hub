import { ProviderRequestQueue } from './collection-provider-queue';

const jsonResponse = (headers: Record<string, string> = {}): Response =>
  new Response('{}', { status: 200, headers });

/**
 * Deterministic fake clock: `now()` reads the mutable cursor; `sleep()`
 * advances it by exactly the requested amount instead of using real timers.
 * Starts well above 0 — like the real `Date.now()` epoch — so it never
 * collides with the queue's `lastDispatchAt = 0` initial sentinel.
 */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let cursor = 1_000_000;
  return {
    now: () => cursor,
    sleep: (ms: number) => {
      cursor += ms;
      return Promise.resolve();
    },
  };
}

describe('ProviderRequestQueue', () => {
  it('paces dispatches at least 250ms apart', async () => {
    const clock = fakeClock();
    const queue = new ProviderRequestQueue(clock.now, clock.sleep);
    const dispatchTimes: number[] = [];
    const fetcher = (): Promise<Response> => {
      dispatchTimes.push(clock.now());
      return Promise.resolve(jsonResponse());
    };
    const wrapped = queue.wrapFetcher(fetcher);

    await wrapped('https://api.github.com/a');
    await wrapped('https://api.github.com/b');
    await wrapped('https://api.github.com/c');

    expect(dispatchTimes).toHaveLength(3);
    const [first, second, third] = dispatchTimes as [number, number, number];
    expect(second - first).toBeGreaterThanOrEqual(250);
    expect(third - second).toBeGreaterThanOrEqual(250);
  });

  it('does not pace the very first dispatch', async () => {
    const clock = fakeClock();
    const queue = new ProviderRequestQueue(clock.now, clock.sleep);
    const wrapped = queue.wrapFetcher(() => Promise.resolve(jsonResponse()));
    const start = clock.now();
    await wrapped('https://api.github.com/a');
    expect(clock.now()).toBe(start);
  });

  it('keeps FIFO pacing across a failed dispatch', async () => {
    const clock = fakeClock();
    const queue = new ProviderRequestQueue(clock.now, clock.sleep);
    const dispatchTimes: number[] = [];
    let call = 0;
    const fetcher = (): Promise<Response> => {
      dispatchTimes.push(clock.now());
      call += 1;
      if (call === 2) return Promise.reject(new Error('upstream failure'));
      return Promise.resolve(jsonResponse());
    };
    const wrapped = queue.wrapFetcher(fetcher);

    const firstRequest = wrapped('https://api.github.com/a');
    const secondRequest = wrapped('https://api.github.com/b');
    const thirdRequest = wrapped('https://api.github.com/c');

    await firstRequest;
    await expect(secondRequest).rejects.toThrow('upstream failure');
    await thirdRequest;

    expect(dispatchTimes).toHaveLength(3);
    const [first, second, third] = dispatchTimes as [number, number, number];
    expect(second - first).toBeGreaterThanOrEqual(250);
    // The failed second dispatch must not let the third jump the queue.
    expect(third - second).toBeGreaterThanOrEqual(250);
  });

  it('observes rate-limit headers without reporting shouldStop before any response', () => {
    const queue = new ProviderRequestQueue();
    expect(queue.shouldStop()).toBe(false);
  });

  it('reports shouldStop once remaining drops to the dynamic floor (max(100, 20% of limit))', async () => {
    const queue = new ProviderRequestQueue(
      () => 0,
      () => Promise.resolve(),
    );
    const wrapped = queue.wrapFetcher(() =>
      Promise.resolve(
        jsonResponse({
          'x-ratelimit-remaining': '250',
          'x-ratelimit-limit': '5000',
        }),
      ),
    );
    await wrapped('https://api.github.com/a');
    // floor = max(100, 5000*0.2=1000) = 1000; remaining 250 <= 1000
    expect(queue.shouldStop()).toBe(true);
  });

  it('uses the 100-request floor when 20% of the limit is smaller', async () => {
    const queue = new ProviderRequestQueue(
      () => 0,
      () => Promise.resolve(),
    );
    const wrapped = queue.wrapFetcher(() =>
      Promise.resolve(
        jsonResponse({
          'x-ratelimit-remaining': '150',
          'x-ratelimit-limit': '300',
        }),
      ),
    );
    await wrapped('https://api.github.com/a');
    // floor = max(100, 300*0.2=60) = 100; remaining 150 > 100
    expect(queue.shouldStop()).toBe(false);
  });

  it('does not consume the response body while observing headers', async () => {
    const queue = new ProviderRequestQueue();
    const wrapped = queue.wrapFetcher(() =>
      Promise.resolve(
        jsonResponse({
          'x-ratelimit-remaining': '4000',
          'x-ratelimit-limit': '5000',
        }),
      ),
    );
    const response = await wrapped('https://api.github.com/a');
    await expect(response.json()).resolves.toEqual({});
  });
});
