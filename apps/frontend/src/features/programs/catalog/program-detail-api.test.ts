import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramDetail, getPublicProgramDetail, listPrograms } from './api';
import type { ProgramDetail } from './dto';

const publicDetail: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 운영기관',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  description: '합성 설명',
  repositoryProvisioningEnabled: true,
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

describe.each([getPublicProgramDetail, getProgramDetail])(
  '배포 순서 호환성: 상세',
  (loadDetail) => {
    it.each([{}, { lifecycle: 'PUBLISHED' }])(
      '이전 서버가 게시 상태 %o를 실어 보내도 응답을 그대로 돌려준다',
      async (extra) => {
        const response: unknown = JSON.parse(
          JSON.stringify({ ...publicDetail, ...extra }),
        );
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
        );

        await expect(loadDetail('program-1')).resolves.toEqual(response);
      },
    );
  },
);

describe('배포 순서 호환성: 목록', () => {
  const params = { page: 2, pageSize: 10, search: '', status: 'all' } as const;
  const item = {
    id: 'program-1',
    name: '합성 프로그램',
    organizer: '합성 운영기관',
    trackType: 'EXTRACURRICULAR',
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-31T00:00:00.000Z',
    endAt: null,
    description: '',
  };

  it('게시 상태가 없는 항목과 이전 서버의 PUBLISHED 항목을 페이지 정보와 함께 돌려준다', async () => {
    const response = {
      items: [item, { ...item, lifecycle: 'PUBLISHED' }],
      page: 2,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
    );

    await expect(listPrograms(params)).resolves.toEqual(response);
  });
});

describe('getPublicProgramDetail', () => {
  it('공개 endpoint 하나만 부른다 — 비로그인 방문자가 401을 만들지 않는 길(#1294)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(publicDetail), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPublicProgramDetail('program-1')).resolves.toEqual(
      publicDetail,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1'),
      undefined,
    );
  });
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

it('운영 화면 요청은 서버에 명시적 화면 모드를 전달한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(publicDetail), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await getProgramDetail('program-1', true);
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('programs/program-1/viewer?view=operations'),
    undefined,
  );
});
