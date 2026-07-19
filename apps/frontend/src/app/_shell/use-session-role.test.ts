import { describe, expect, it, vi } from 'vitest';
import { createDedupedFetcher } from './use-session-role';

// createDedupedFetcher는 순수 함수라 React 렌더링·jsdom 없이(이 repo의
// vitest는 node 환경) in-flight dedup 동작만 독립적으로 검증할 수 있다.
describe('createDedupedFetcher', () => {
  it('동시 호출은 같은 promise를 공유하고 fetcher는 1회만 호출된다', async () => {
    const fetcher = vi.fn(() => Promise.resolve('value'));
    const deduped = createDedupedFetcher(fetcher);

    const first = deduped();
    const second = deduped();

    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe('value');
  });

  it('성공 후 settle되면 다음 호출은 새 promise로 다시 fetch한다', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const deduped = createDedupedFetcher(fetcher);

    const first = deduped();
    await expect(first).resolves.toBe('first');

    const second = deduped();
    expect(second).not.toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toBe('second');
  });

  it('reject되어도 in-flight 슬롯이 초기화돼 다음 호출은 새로 fetch한다', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const deduped = createDedupedFetcher(fetcher);

    await expect(deduped()).rejects.toThrow('boom');

    const second = deduped();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toBe('recovered');
  });
});
