import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiClient,
  apiFileClient,
  isUnexpectedApiProblem,
} from './api-client';

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
      expect(isUnexpectedApiProblem(error)).toBe(false);
    }
  });

  it('ProblemDetail이 아닌 실패를 사람이 읽는 문장으로 감싼다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>413 Request Entity Too Large</html>', {
          status: 413,
          statusText: 'Request Entity Too Large',
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    try {
      await apiClient('/milestone-document-files');
      throw new Error('ApiError가 발생해야 합니다.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError);
      const { problem } = error as ApiError;
      expect(problem.detail).toBe(
        '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
      expect(problem.detail).not.toContain('ProblemDetail');

      expect(problem.code).toBe('API_000');
      expect(problem.status).toBe(413);
      expect(problem.instance).toBe('/api/v1/milestone-document-files');
      expect(isUnexpectedApiProblem(error)).toBe(true);
    }
  });
});

describe('apiFileClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binary body와 RFC 5987 파일명을 함께 반환한다', async () => {
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

    const result = await apiFileClient('current/file');

    await expect(result.blob.text()).resolves.toBe('current-bytes');
    expect(result.fileName).toBe('현재.pdf');
  });

  it('ProblemDetail 실패를 JSON API와 같은 ApiError로 변환한다', async () => {
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

    await expect(apiFileClient('current/file')).rejects.toMatchObject({
      problem,
    });
  });
});
