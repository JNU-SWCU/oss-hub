type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MIN_PACING_MS = 250;

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

  shouldStop(): boolean {
    if (this.remaining === null || this.limit === null) return false;
    return this.remaining <= Math.max(100, Math.floor(this.limit * 0.2));
  }
}
