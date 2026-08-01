type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MIN_PACING_MS = 250;

/**
 * ADR-006 fair serial provider-request queue (todo 10 sync orchestration).
 * Every GitHub REST request the sync makes passes through exactly one FIFO
 * queue — `wrapFetcher` swaps in for `CollectionAppClient`'s fetcher without
 * changing anything about the client itself. Two responsibilities:
 *
 * 1. Pacing: dispatches are serialized and spaced at least `MIN_PACING_MS`
 *    apart (a failed dispatch does not let a later one jump the queue).
 * 2. Rate-limit awareness: every response's `x-ratelimit-remaining`/
 *    `x-ratelimit-limit` headers are observed (peeking at headers does not
 *    consume the body, so the wrapped client still reads the same response
 *    normally). `shouldStop()` reports the ADR-006 dynamic stop condition
 *    (`remaining <= max(100, 20% of limit)`) so the orchestrator can end a
 *    run *before* hitting a hard rate limit, rather than only reacting to a
 *    429/403 thrown by the client.
 */
export class ProviderRequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private lastDispatchAt = 0;
  private remaining: number | null = null;
  private limit: number | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  ) {}

  wrapFetcher(fetcher: Fetcher): Fetcher {
    return (input, init) => this.enqueue(() => fetcher(input, init));
  }

  private enqueue(run: () => Promise<Response>): Promise<Response> {
    const scheduled = this.tail.then(async () => {
      const wait = this.lastDispatchAt + MIN_PACING_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastDispatchAt = this.now();
      const response = await run();
      this.observe(response);
      return response;
    });
    // Swallow the rejection on the shared tail so a failed request does not
    // let subsequent requests skip the queue — each still awaits its turn.
    this.tail = scheduled.catch(() => undefined);
    return scheduled;
  }

  private observe(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    if (remaining !== null && /^\d+$/.test(remaining)) {
      this.remaining = Number(remaining);
    }
    if (limit !== null && /^\d+$/.test(limit)) {
      this.limit = Number(limit);
    }
  }

  /** ADR-006 dynamic stop: `remaining <= max(100, 20% of limit)`. */
  shouldStop(): boolean {
    if (this.remaining === null || this.limit === null) return false;
    return this.remaining <= Math.max(100, Math.floor(this.limit * 0.2));
  }
}
