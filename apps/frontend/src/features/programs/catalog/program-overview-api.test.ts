import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramOverview } from './program-overview-api';
import type { ProgramOverview } from './program-overview-dto';

const overview: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
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
  milestoneDocuments: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramOverview', () => {
  it.each(['PUBLISHED', 'ARCHIVED', undefined] as const)(
    '기존 상태와 필드 부재 %s를 읽는다',
    async (lifecycle) => {
      const response: unknown = JSON.parse(
        JSON.stringify({ ...overview, lifecycle }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
      );

      await expect(getProgramOverview('program-1')).resolves.toEqual(response);
    },
  );

  it.each(['ACTIVE', 'DRAFT', null, 0, false])(
    '제공된 잘못된 게시 상태 %s를 거부한다',
    async (lifecycle) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ...overview, lifecycle })),
          ),
      );

      await expect(getProgramOverview('program-1')).rejects.toThrow(
        '프로그램 게시 상태 응답 형식이 올바르지 않습니다.',
      );
    },
  );

  it('필드가 없어도 기존 category 거부 검증을 유지한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...overview,
            lifecycle: undefined,
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
