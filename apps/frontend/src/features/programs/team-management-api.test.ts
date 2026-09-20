import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  deleteStaffProgramTeam,
  getApplicationDetailWithHistory,
  listTeamManagementApplications,
} from './api';
import type { TeamDeletionScope } from './types';

const SCOPE = {
  applications: 1,
  members: 2,
  invitations: 0,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 0,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
} as TeamDeletionScope;

let fetchMock: ReturnType<typeof vi.fn>;

function lastRequest() {
  // GET 은 init 없이 호출된다 — 없는 값을 있는 것처럼 읽지 않는다.
  const [input, init] = fetchMock.mock.calls[0] as [
    string,
    RequestInit | undefined,
  ];
  return { url: input, init: init ?? {} };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listTeamManagementApplications', () => {
  it('같은 endpoint 에 view=team-management 를 붙여 lean projection 을 고른다', async () => {
    await listTeamManagementApplications('program 1', {
      page: 2,
      pageSize: 20,
      search: '가나다',
      status: 'SUBMITTED',
    });

    const { url } = lastRequest();
    expect(url).toContain(apiPath('programs/program%201/applications?'));
    expect(url).toContain('view=team-management');
    expect(url).toContain('page=2');
    expect(url).toContain('status=SUBMITTED');
    // 검색어는 인코딩돼 실린다 — 원문이 그대로 주소에 붙지 않는다.
    expect(url).not.toContain('가나다');
  });
});

describe('getApplicationDetailWithHistory', () => {
  /*
   * 프런트는 Vercel, backend 는 Jenkins 라 따로 배포된다. 프런트가 먼저 올라간 창에서
   * 이 키를 모르는 backend 가 응답해도 화면이 죽지 않아야 한다.
   */
  it.each([
    ['키가 없을 때', {}],
    ['null 일 때', { reviewHistory: null }],
    ['배열이 아닐 때', { reviewHistory: 'nope' }],
  ])('검토 이력이 %s 빈 배열로 읽는다', async (_label, payload) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'app-1', ...payload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const detail = await getApplicationDetailWithHistory('app-1');

    expect(detail.reviewHistory).toEqual([]);
  });

  it('이력이 오면 그대로 쓴다 — 빈 배열로 덮지 않는다', async () => {
    const reviewHistory = [{ id: 'h1' }];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'app-1', reviewHistory }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const detail = await getApplicationDetailWithHistory('app-1');

    expect(detail.reviewHistory).toEqual(reviewHistory);
  });

  it('상세는 새 경로가 아니라 같은 신청 endpoint 하나다', async () => {
    await getApplicationDetailWithHistory('synthetic/application');

    const { url, init } = lastRequest();
    expect(url).toBe(apiPath('applications/synthetic%2Fapplication'));
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
  });
});

describe('deleteStaffProgramTeam', () => {
  it('알림 문구를 주지 않으면 키째 빼고 보낸다', async () => {
    await deleteStaffProgramTeam('program-1', 'team-1', SCOPE);

    const body: unknown = JSON.parse(String(lastRequest().init.body));
    expect(body).toEqual({ expectedScope: SCOPE });
  });

  it.each(['', '   ', '\n\t'])(
    '빈 문구(%j)도 적지 않은 것과 같게 보낸다',
    async (message) => {
      await deleteStaffProgramTeam('program-1', 'team-1', SCOPE, message);

      const body: unknown = JSON.parse(String(lastRequest().init.body));
      expect(body).toEqual({ expectedScope: SCOPE });
    },
  );

  it('문구를 주면 앞뒤 공백을 접어 함께 보낸다', async () => {
    await deleteStaffProgramTeam(
      'program-1',
      'team-1',
      SCOPE,
      '  중복 신청이라 정리했습니다  ',
    );

    const body: unknown = JSON.parse(String(lastRequest().init.body));
    expect(body).toEqual({
      expectedScope: SCOPE,
      notificationMessage: '중복 신청이라 정리했습니다',
    });
  });

  it('확인 범위는 문구와 무관하게 항상 실린다 — 서버가 재확인에 쓴다', async () => {
    await deleteStaffProgramTeam('program-1', 'team-1', SCOPE, '문구');

    const { init } = lastRequest();
    expect(init.method).toBe('DELETE');
    const body = JSON.parse(String(init.body)) as {
      readonly expectedScope: unknown;
    };
    expect(body.expectedScope).toEqual(SCOPE);
  });
});
