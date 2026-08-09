// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProgramStaffTeamsPage,
  joinTeamsWithApplications,
  memberSummary,
} from './program-staff-teams-page';
import type {
  ApplicationListItem,
  ApplicationListPage,
  StaffProgramTeam,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const { listStaffProgramTeamsMock, listProgramApplicationsMock } = vi.hoisted(
  () => ({
    listStaffProgramTeamsMock: vi.fn(),
    listProgramApplicationsMock: vi.fn(),
  }),
);

vi.mock('./api', () => ({
  listStaffProgramTeams: listStaffProgramTeamsMock,
  listProgramApplications: listProgramApplicationsMock,
}));

function team(
  teamId: string,
  name: string,
  members: StaffProgramTeam['members'],
): StaffProgramTeam {
  return { teamId, name, memberCount: members.length, members };
}

function member(
  nickname: string,
  realName: string | null,
  isLeader = false,
): StaffProgramTeam['members'][number] {
  return { userId: `user-${nickname}`, name: realName, nickname, isLeader };
}

function application(
  teamId: string | null,
  status: ApplicationListItem['status'],
  repository: ApplicationListItem['repository'] = null,
): ApplicationListItem {
  return {
    id: `app-${teamId ?? 'none'}`,
    programId: 'program-1',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status,
    rejectionReason: null,
    repositoryProvisioning: {
      enabled: true,
      jobStatus: 'SUCCEEDED',
      updatedAt: '2026-08-01T00:00:00.000Z',
      safeErrorClass: null,
    },
    isRepositoryPublicationPlanned: false,
    repository,
    submittedAt: '2026-08-01T00:00:00.000Z',
    participation: 'TEAM',
    applicant: { id: 'u1', name: '김철수', nickname: 'chulsoo' },
    team: teamId === null ? null : { id: teamId, name: 't', memberCount: 2 },
    answers: { applicantName: '김철수', title: '제목', summary: '요약' },
  };
}

function page(items: readonly ApplicationListItem[]): ApplicationListPage {
  return {
    items,
    page: 1,
    pageSize: 200,
    totalItems: items.length,
    totalPages: 1,
  };
}

describe('joinTeamsWithApplications', () => {
  it('teamId 로 신청을 붙이고, 신청이 없는 팀은 null 로 남긴다', () => {
    const teams = [
      team('t1', '가팀', [member('a', '김가')]),
      team('t2', '나팀', [member('b', '이나')]),
    ];

    const rows = joinTeamsWithApplications(teams, [
      application('t1', 'APPROVED'),
    ]);

    expect(rows.map((row) => row.application?.status ?? null)).toEqual([
      'APPROVED',
      null,
    ]);
  });

  it('팀 없는 신청(개인형 legacy)은 어느 팀에도 붙지 않는다', () => {
    const rows = joinTeamsWithApplications(
      [team('t1', '가팀', [member('a', '김가')])],
      [application(null, 'APPROVED')],
    );

    expect(rows[0]?.application).toBeNull();
  });

  it('팀 목록이 기준 축이다 — 신청이 있어도 팀에 없으면 행이 생기지 않는다', () => {
    const rows = joinTeamsWithApplications([], [application('t9', 'APPROVED')]);

    expect(rows).toEqual([]);
  });
});

describe('memberSummary', () => {
  it('실명이 있으면 실명을, 없으면 GitHub 계정을 쓴다', () => {
    expect(
      memberSummary(team('t', '팀', [member('a', '김가'), member('b', null)])),
    ).toBe('김가 · b');
  });

  it('네 명 이상이면 세 명까지만 적고 나머지는 수로 줄인다', () => {
    expect(
      memberSummary(
        team('t', '팀', [
          member('a', '김가'),
          member('b', '이나'),
          member('c', '박다'),
          member('d', '최라'),
        ]),
      ),
    ).toBe('김가 · 이나 · 박다 · 외 1명');
  });
});

describe('ProgramStaffTeamsPage', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listStaffProgramTeamsMock.mockReset();
    listProgramApplicationsMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(
    teams: readonly StaffProgramTeam[],
    applications: readonly ApplicationListItem[],
  ): Promise<void> {
    listStaffProgramTeamsMock.mockResolvedValue(teams);
    listProgramApplicationsMock.mockResolvedValue(page(applications));
    await act(async () => {
      root.render(<ProgramStaffTeamsPage programId="program-1" />);
    });
  }

  it('신청서를 내지 않은 팀도 목록에 남고 그렇게 표시된다', async () => {
    await render(
      [
        team('t1', '가팀', [member('a', '김가', true)]),
        team('t2', '나팀', [member('b', '이나', true)]),
      ],
      [application('t1', 'APPROVED')],
    );

    expect(container.textContent).toContain('나팀');
    expect(container.textContent).toContain('신청서 안 냄');
  });

  it('팀원 실명을 보여준다', async () => {
    await render(
      [team('t1', '가팀', [member('chulsoo', '김철수', true)])],
      [application('t1', 'APPROVED')],
    );

    expect(container.textContent).toContain('김철수');
    expect(container.textContent).toContain('@chulsoo');
  });

  it('프로필이 비어 있는 팀원은 GitHub 계정으로 떨어진다', async () => {
    await render(
      [team('t1', '가팀', [member('nameless', null, true)])],
      [application('t1', 'APPROVED')],
    );

    expect(container.textContent).toContain('nameless');
  });

  it('저장소 공개 여부에 따라 링크 문구가 갈린다', async () => {
    await render(
      [
        team('t1', '가팀', [member('a', '김가', true)]),
        team('t2', '나팀', [member('b', '이나', true)]),
      ],
      [
        application('t1', 'APPROVED', {
          url: 'https://github.com/org/public-repo',
          visibility: 'PUBLIC',
        }),
        application('t2', 'APPROVED', {
          url: 'https://github.com/org/private-repo',
          visibility: 'PRIVATE',
        }),
      ],
    );

    expect(container.textContent).toContain('공개 저장소 열기');
    expect(container.textContent).toContain('비공개 저장소 확인');
    const links = [...container.querySelectorAll('a')].map((a) => a.href);
    expect(links).toContain('https://github.com/org/public-repo');
    expect(links).toContain('https://github.com/org/private-repo');
  });

  it('저장소가 없으면 링크를 만들지 않는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'SUBMITTED')],
    );

    expect(container.textContent).toContain('아직 없음');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('신청을 전부 받으면 잘림 안내를 띄우지 않는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'APPROVED')],
    );

    expect(container.textContent).not.toContain('일부만 불러왔습니다');
  });

  // 조용히 자르면 신청이 있는 팀이 「신청서 안 냄」으로 보인다 — 빈 화면보다 나쁘다.
  it('신청이 상한을 넘으면 일부만 받았다고 알린다', async () => {
    listStaffProgramTeamsMock.mockResolvedValue([
      team('t1', '가팀', [member('a', '김가', true)]),
    ]);
    listProgramApplicationsMock.mockResolvedValue({
      ...page([]),
      totalPages: 999,
      totalItems: 99_900,
    });
    await act(async () => {
      root.render(<ProgramStaffTeamsPage programId="program-1" />);
    });

    expect(container.textContent).toContain('일부만 불러왔습니다');
  });

  it('불러오기에 실패하면 안내를 띄운다', async () => {
    listStaffProgramTeamsMock.mockRejectedValue(new Error('boom'));
    listProgramApplicationsMock.mockResolvedValue(page([]));
    await act(async () => {
      root.render(<ProgramStaffTeamsPage programId="program-1" />);
    });

    expect(container.textContent).toContain('참여 팀을 불러오지 못했습니다');
  });
});
