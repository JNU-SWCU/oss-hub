import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  getRepositoryHistory,
  getTeamActivity,
  parseRepositoryHistory,
  parseTeamActivity,
  TeamActivityResponseError,
  type RepositoryHistoryPage,
  type TeamActivity,
} from './team-activity-api';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

const activity: TeamActivity = {
  applicationId: 'application-1',
  repository: { id: 'repo-1', url: 'https://github.com/synthetic/current' },
  status: 'COLLECTED',
  lastSuccessAt: '2026-09-01T00:00:00.000Z',
  window: { from: '2026-09-01', to: '2026-12-31', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: true,
  members: [
    {
      userId: 'user-1',
      githubLogin: 'synthetic-member',
      totals: { commitCount: 2, pullRequestCount: 1, issueCount: 0 },
      points: [
        {
          date: '2026-09-02',
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 0,
        },
      ],
    },
  ],
};

const history: RepositoryHistoryPage = {
  items: [
    {
      id: 'audit-1',
      occurredAt: '2026-09-01T00:00:00.000Z',
      actorGithubLogin: 'synthetic-author',
      previousRepositoryUrl: null,
      newRepositoryUrl: 'https://github.com/synthetic/current',
    },
  ],
  nextCursor: 'opaque-cursor',
};

const [firstMember] = activity.members;
if (firstMember === undefined) throw new Error('fixture member required');

describe('team activity boundary', () => {
  it('학생·교직원이 같은 경로로 읽고 응답을 그대로 돌려준다', async () => {
    vi.mocked(apiClient).mockResolvedValue(activity);

    await expect(getTeamActivity('program/1', 'team/1')).resolves.toEqual(
      activity,
    );
    expect(apiClient).toHaveBeenLastCalledWith(
      'programs/program%2F1/teams/team%2F1/activity',
    );
  });

  it.each([
    ['미연결', { ...activity, status: 'NOT_CONNECTED', repository: null }],
    [
      '센티널 창',
      {
        ...activity,
        window: {
          from: '0001-01-01',
          to: '+010000-01-01',
          timeZone: 'Asia/Seoul',
        },
      },
    ],
    ['신청 없는 팀', { ...activity, applicationId: null }],
  ])('%s 응답을 받는다', (_label, value) => {
    expect(parseTeamActivity(value)).toEqual(value);
  });

  it.each([
    ['빈 값', {}],
    ['모르는 상태', { ...activity, status: 'UNKNOWN' }],
    ['저장소 없는 수집 상태', { ...activity, repository: null }],
    ['저장소 있는 미연결', { ...activity, status: 'NOT_CONNECTED' }],
    [
      '안전하지 않은 저장소 주소',
      {
        ...activity,
        repository: { id: 'repo-1', url: 'javascript:alert(1)' },
      },
    ],
    ['날짜가 아닌 마지막 수집', { ...activity, lastSuccessAt: 'not-a-date' }],
    [
      '서울이 아닌 창',
      { ...activity, window: { ...activity.window, timeZone: 'UTC' } },
    ],
    [
      '음수 합계',
      {
        ...activity,
        members: [
          {
            ...firstMember,
            totals: { ...firstMember.totals, commitCount: -1 },
          },
        ],
      },
    ],
    [
      '이슈 수가 빠진 날',
      {
        ...activity,
        members: [
          {
            ...firstMember,
            points: [
              { date: '2026-09-02', commitCount: 1, pullRequestCount: 0 },
            ],
          },
        ],
      },
    ],
    [
      '없는 날짜',
      {
        ...activity,
        members: [
          {
            ...firstMember,
            points: [{ ...firstMember.points[0], date: '2026-02-30' }],
          },
        ],
      },
    ],
    ['같은 팀원 두 번', { ...activity, members: [firstMember, firstMember] }],
  ])('%s은 계약 위반으로 끊는다', (_label, value) => {
    expect(() => parseTeamActivity(value)).toThrow(TeamActivityResponseError);
  });

  it('변경 이력 첫 쪽은 커서 없이 읽는다', async () => {
    vi.mocked(apiClient).mockResolvedValue(history);

    await expect(getRepositoryHistory('program/1', 'team/1')).resolves.toEqual(
      history,
    );
    expect(apiClient).toHaveBeenLastCalledWith(
      'programs/program%2F1/teams/team%2F1/repository-url-history',
    );
  });

  it('다음 쪽 커서는 바꾸지 않고 인코딩만 한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(history);

    await getRepositoryHistory('program/1', 'team/1', 'cursor+=/');

    expect(apiClient).toHaveBeenLastCalledWith(
      'programs/program%2F1/teams/team%2F1/repository-url-history?cursor=cursor%2B%3D%2F',
    );
  });

  it.each([
    [{ items: [], nextCursor: undefined }],
    [
      {
        items: [
          {
            ...history.items[0],
            newRepositoryUrl: 'https://example.com/untrusted',
          },
        ],
        nextCursor: null,
      },
    ],
  ])('형식이 어긋난 변경 이력 %j을 끊는다', (value) => {
    expect(() => parseRepositoryHistory(value)).toThrow(
      TeamActivityResponseError,
    );
  });
});
