import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramOverview } from './program-overview-api';
import type { ProgramOverview } from './program-overview-dto';

const overview: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  trackType: 'EXTRACURRICULAR',
  milestoneCount: 3,
  boardPostCount: 5,
  participantCount: 12,
  teamCount: 4,
  connectedRepositoryCount: 3,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: 2,
  viewerDocumentsTotal: 5,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  requirements: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramOverview', () => {
  it.each([{}, { lifecycle: 'PUBLISHED' }])(
    '이전 서버가 게시 상태 %o를 실어 보내도 응답을 그대로 읽는다',
    async (extra) => {
      const response: unknown = JSON.parse(
        JSON.stringify({ ...overview, ...extra }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
      );

      await expect(getProgramOverview('program-1')).resolves.toEqual(response);
    },
  );

  it('기존 category 거부 검증을 유지한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...overview,
            category: 'legacy',
          }),
        ),
      ),
    );

    await expect(getProgramOverview('program-1')).rejects.toThrow(
      '프로그램 개요 응답 형식이 올바르지 않습니다.',
    );
  });

  it('programId를 인코딩해 올바른 경로로 GET 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(overview), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProgramOverview('program 1')).resolves.toEqual(overview);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program%201/overview'),
      undefined,
    );
  });
});

it('운영 화면 요청은 서버에 명시적 화면 모드를 전달한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(overview), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await getProgramOverview('program-1', true);
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('programs/program-1/overview?view=operations'),
    undefined,
  );
});
