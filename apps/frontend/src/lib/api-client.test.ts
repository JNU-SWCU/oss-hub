import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from './api-client';

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('성공 응답의 JSON DTO를 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'member-1', name: '홍길동' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient<{ id: string; name: string }>('members/member-1'),
    ).resolves.toEqual({
      id: 'member-1',
      name: '홍길동',
    });
  });

  it('ProblemDetail 오류 응답을 ApiError로 변환한다', async () => {
    const problem = {
      type: 'https://oss-hub.dev/problems/member-not-found',
      title: '회원을 찾을 수 없습니다.',
      status: 404,
      detail: 'member-1 회원이 존재하지 않습니다.',
      instance: '/members/member-1',
      code: 'MEM_001',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await apiClient('/members/member-1');
      throw new Error('ApiError가 발생해야 합니다.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).problem).toEqual(problem);
    }
  });
});
