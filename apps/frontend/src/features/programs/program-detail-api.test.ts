import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramDetail } from './api';
import type { ProgramDetail } from './types';

const publicDetail: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 운영기관',
  category: 'OSS_CONTEST',
  description: '합성 설명',
  applicationPeriod: {
    startsAt: '2026-08-01T00:00:00+09:00',
    endsAt: '2026-08-15T23:59:59+09:00',
  },
  viewer: { role: null, applicationStatus: null },
  milestones: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramDetail', () => {
  it('인증 viewer endpoint가 401이면 private join 없는 공개 endpoint로 폴백한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'UNAUTHORIZED',
            status: 401,
            detail: '인증이 필요합니다.',
            instance: '/programs/program-1/viewer',
            code: 'AUT_003',
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(publicDetail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProgramDetail('program-1')).resolves.toEqual(publicDetail);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      apiPath('programs/program-1/viewer'),
      undefined,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      apiPath('programs/program-1'),
      undefined,
    );
  });

  it('인증 viewer endpoint의 일반 실패는 공개 응답으로 숨기지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'INTERNAL_SERVER_ERROR',
          status: 500,
          detail: '프로그램 상세 정보를 불러오지 못했습니다.',
          instance: '/programs/program-1/viewer',
          code: 'PROGRAM_DETAIL_LOAD_FAILED',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProgramDetail('program-1')).rejects.toMatchObject({
      problem: { code: 'PROGRAM_DETAIL_LOAD_FAILED' },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
