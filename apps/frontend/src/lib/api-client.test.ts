import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient, apiFileClient } from './api-client';

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

  /**
   * Nest는 handler가 `null`을 돌려주면 본문 없이 200을 보낸다. 실배포의
   * `role-requests/me`가 그 경우이고, 여기서 거절하면 역할 요청이 아직 없는
   * 신규 가입자가 첫 화면에서 통째로 오류로 접혔다.
   */
  it('본문이 빈 성공 응답을 null로 읽는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient<{ status: string } | null>('role-requests/me'),
    ).resolves.toBeNull();
  });

  it('본문이 JSON null인 성공 응답도 null로 읽는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('null', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient<{ status: string } | null>('role-requests/me'),
    ).resolves.toBeNull();
  });

  it('본문이 있는데 JSON이 아니면 그대로 거절한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html></html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient('programs')).rejects.toBeInstanceOf(SyntaxError);
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

describe('apiFileClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binary body와 RFC 5987 파일명을 함께 반환한다', async () => {
    // Given
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('current-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition':
            'attachment; filename="current.pdf"; filename*=UTF-8\'\'%ED%98%84%EC%9E%AC.pdf',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await apiFileClient('current/file');

    // Then
    await expect(result.blob.text()).resolves.toBe('current-bytes');
    expect(result.fileName).toBe('현재.pdf');
  });

  it('ProblemDetail 실패를 JSON API와 같은 ApiError로 변환한다', async () => {
    // Given
    const problem = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: '제출된 파일을 찾을 수 없습니다.',
      instance: '/current/file',
      code: 'MSD_020',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    );

    // When / Then
    await expect(apiFileClient('current/file')).rejects.toMatchObject({
      problem,
    });
  });
});
