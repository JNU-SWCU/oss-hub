import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { fetchSystemStatus } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('system status api', () => {
  it('GET system-status의 정확한 DTO를 반환한다', async () => {
    const dto = {
      health: 'DELAYED',
      lastCompleteSuccessAt: '2026-07-25T10:00:00.000Z',
      dataAsOf: '2026-07-25T10:01:00.000Z',
      currentRunStatus: 'PROCESSING',
      safeReason: 'STALE_DATA',
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ collection: dto }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual(dto);
    expect(request).toHaveBeenCalledWith(apiPath('system-status'), undefined);
  });

  it('전송 오류를 성공 상태로 위장하지 않고 전파한다', async () => {
    const failure = new TypeError('synthetic transport failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(fetchSystemStatus()).rejects.toBe(failure);
  });
});
