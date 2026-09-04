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
import {
  programApplicationDetailHref,
  programTeamDetailHref,
} from '@/lib/program-route';
import { REVIEW_ACTION_LABEL } from './application-presentation';
import type {
  ApplicationListItem,
  ApplicationListPage,
  StaffProgramTeam,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
}));

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
  provisioning: Partial<ApplicationListItem['repositoryProvisioning']> = {},
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
      ...provisioning,
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
    pushMock.mockReset();
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
    expect(container.textContent).toContain('미신청');
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

  it('저장소가 없으면 저장소 링크를 만들지 않는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'SUBMITTED', null, { jobStatus: 'NOT_REQUESTED' })],
    );

    // 신청은 있고 발급을 아직 요청하지 않은 상태다 — 신청 자체가 없는
    // 「아직 없음」과 구분한다.
    expect(container.textContent).toContain('요청 전');
    // 헤더의 「신청 목록 보기」만 남고, github 저장소 링크는 없다.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.href);
    expect(hrefs.some((href) => href.includes('github.com'))).toBe(false);
    expect(
      hrefs.some((href) => href.includes('/programs/program-1/applicants')),
    ).toBe(true);
  });

  /**
   * 2026-08-11 QA — 학생 대시보드는 「저장소 생성에 실패했습니다」를 명시하는데
   * 이 화면은 같은 팀을 「아직 없음」으로만 보여 줬다. 교직원은 **문제가 있다는 것조차
   * 몰랐다.** 두 화면이 같은 상황을 다르게 말하지 않게 고정한다.
   */
  it('발급이 실패한 팀을 「아직 없음」이 아니라 실패로 보여 준다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [
        application('t1', 'APPROVED', null, {
          jobStatus: 'FAILED',
          safeErrorClass: 'AUTH',
        }),
      ],
    );

    const text = container.textContent ?? '';
    expect(text).toContain('생성 실패');
    expect(text).not.toContain('아직 없음');
    // 표에서 눈에 띄어야 한다 — 신청 상태는 APPROVED 라 rejected 뱃지는 이 칸뿐이다.
    // 뱃지는 색·글자·점 세 신호를 함께 쓰므로 색각 이상 사용자도 구분할 수 있다.
    expect(
      container.querySelector(
        '[data-slot="status-badge"][data-variant="rejected"]',
      )?.textContent,
    ).toContain('생성 실패');
  });

  it('재시도 대기도 조용히 넘기지 않는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [
        application('t1', 'APPROVED', null, {
          jobStatus: 'RETRYABLE_FAILED',
          safeErrorClass: 'RATE_LIMIT',
        }),
      ],
    );

    const text = container.textContent ?? '';
    expect(text).toContain('재시도 대기');
    expect(text).not.toContain('아직 없음');
    expect(
      container.querySelector(
        '[data-slot="status-badge"][data-variant="rejected"]',
      )?.textContent,
    ).toContain('재시도 대기');
  });

  it('진행 중인 발급은 진행 중으로 보여 준다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'APPROVED', null, { jobStatus: 'PROCESSING' })],
    );

    const text = container.textContent ?? '';
    expect(text).toContain('생성 중');
    expect(text).not.toContain('아직 없음');
    // 진행 중은 사람이 손댈 것이 없다 — 실패로 오해하게 만들지 않는다.
    expect(
      container.querySelector(
        '[data-slot="status-badge"][data-variant="rejected"]',
      ),
    ).toBeNull();
  });

  it('신청서를 안 낸 팀만 「아직 없음」으로 남는다', async () => {
    // 발급을 물을 대상 자체가 없는 유일한 경우다.
    await render([team('t1', '가팀', [member('a', '김가', true)])], []);

    expect(container.textContent ?? '').toContain('아직 없음');
  });

  it('헤더에서 신청 목록으로 들어간다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'SUBMITTED')],
    );

    expect(container.textContent).toContain('신청 목록 보기');
    const link = [...container.querySelectorAll('a')].find((a) =>
      a.href.includes('/programs/program-1/applicants'),
    );
    expect(link?.textContent).toContain('신청 목록 보기');
  });

  it('신청을 전부 받으면 잘림 안내를 띄우지 않는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'APPROVED')],
    );

    expect(container.textContent).not.toContain('일부만 불러왔습니다');
  });

  // 조용히 자르면 신청이 있는 팀이 「미신청」으로 보인다 — 빈 화면보다 나쁘다.
  it('신청이 상한을 넘으면 일부만 받았다고 알리고 신청자 목록으로 보낸다', async () => {
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
    const applicantsLinks = [...container.querySelectorAll('a')].filter((a) =>
      a.href.includes('/programs/program-1/applicants'),
    );
    expect(applicantsLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('불러오기에 실패하면 안내를 띄운다', async () => {
    listStaffProgramTeamsMock.mockRejectedValue(new Error('boom'));
    listProgramApplicationsMock.mockResolvedValue(page([]));
    await act(async () => {
      root.render(<ProgramStaffTeamsPage programId="program-1" />);
    });

    expect(container.textContent).toContain('참여 팀을 불러오지 못했습니다');
  });

  /**
   * #1101 — 빈 화면은 세 갈래다. 「아직 없음」·「조건에 안 걸림」·「불러오지 못함」이
   * 서로 다른 사실이고 다른 다음 행동을 부른다. 아래 묶음이 그 경계를 고정한다.
   */
  describe('빈 화면 갈래(#1101)', () => {
    function chip(label: string): HTMLButtonElement {
      const found = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.startsWith(label),
      );
      if (found === undefined)
        throw new Error(`상태 칩을 찾지 못했다: ${label}`);
      return found as HTMLButtonElement;
    }

    function searchInput(): HTMLInputElement {
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="팀 검색"]',
      );
      if (input === null) throw new Error('검색 입력을 찾지 못했다');
      return input;
    }

    async function typeSearch(value: string): Promise<void> {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      const input = searchInput();
      await act(async () => {
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    async function click(element: Element): Promise<void> {
      await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    function button(label: string): HTMLButtonElement | undefined {
      return [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    }

    /**
     * 결함 그대로의 상태 — 아무것도 안 눌렀는데 필터를 바꾸라는 안내가 떴다.
     * 재현 조건(검색어 빈 문자열 · `aria-pressed="true"`인 칩이 기본값 「전체」)까지
     * 함께 고정한다. 이 둘이 어긋나면 문구만 맞고 전제가 틀린 테스트가 된다.
     */
    it('팀이 0팀이면 필터를 걸지 않은 사람에게 필터 이야기를 하지 않는다', async () => {
      await render([], []);

      expect(searchInput().value).toBe('');
      expect(chip('전체').getAttribute('aria-pressed')).toBe('true');

      const text = container.textContent ?? '';
      expect(text).toContain('아직 참여 팀이 없습니다');
      expect(text).toContain('학생이 팀을 만들면 여기에 표시됩니다.');
      expect(text).not.toContain('검색어나 상태 필터를 바꿔 보세요.');
      // 되돌릴 필터가 없는 화면에 되돌리는 버튼을 두지 않는다.
      expect(button('필터 초기화')).toBeUndefined();
    });

    /**
     * ⚠ 순서 규칙. 팀이 0팀인 프로그램에서도 칩은 눌린다 — 그때 필터 탓을 하면
     * 원래 결함으로 되돌아간다. 「아직 없음」이 「조건에 안 걸림」보다 먼저다.
     */
    it('팀이 0팀이면 칩을 눌러 둔 상태여도 여전히 「아직 없음」이다', async () => {
      await render([], []);
      await click(chip('승인'));

      const text = container.textContent ?? '';
      expect(chip('승인').getAttribute('aria-pressed')).toBe('true');
      expect(text).toContain('아직 참여 팀이 없습니다');
      expect(text).not.toContain('검색어나 상태 필터를 바꿔 보세요.');
    });

    it('팀은 있는데 검색어에 아무도 안 걸리면 다른 문구로 말하고 되돌릴 수단을 준다', async () => {
      await render(
        [team('t1', '가팀', [member('a', '김가', true)])],
        [application('t1', 'APPROVED')],
      );
      await typeSearch('없는팀이름');

      const text = container.textContent ?? '';
      expect(text).toContain('조건에 맞는 팀이 없습니다');
      expect(text).toContain('검색어나 상태 필터를 바꿔 보세요.');
      // 두 갈래가 서로 다른 문구여야 한다 — 이 티켓의 본체다.
      expect(text).not.toContain('아직 참여 팀이 없습니다');
      expect(button('필터 초기화')).toBeDefined();
    });

    /**
     * 검색 때문에 0건이든 상태 칩 때문에 0건이든 사용자가 할 일은 같다 —
     * 「조건을 바꾸거나 되돌린다」. 그래서 두 원인을 한 문구로 묶는다.
     */
    it('상태 칩 때문에 0건인 경우도 검색과 같은 문구로 묶는다', async () => {
      await render(
        [team('t1', '가팀', [member('a', '김가', true)])],
        [application('t1', 'APPROVED')],
      );
      await click(chip('반려'));

      const text = container.textContent ?? '';
      expect(text).toContain('조건에 맞는 팀이 없습니다');
      expect(text).toContain('검색어나 상태 필터를 바꿔 보세요.');
      expect(text).not.toContain('아직 참여 팀이 없습니다');
    });

    /**
     * 되돌릴 수단이 하나면 되돌리는 것도 전부여야 한다 — 칩만 풀리고 검색어가 남으면
     * 표는 그대로 비어 있고, 사용자는 버튼이 고장 난 줄 안다.
     */
    it('「필터 초기화」는 검색어와 상태 칩을 함께 되돌려 표를 되살린다', async () => {
      await render(
        [team('t1', '가팀', [member('a', '김가', true)])],
        [application('t1', 'APPROVED')],
      );
      await click(chip('반려'));
      await typeSearch('없는팀이름');

      expect(container.textContent).toContain('조건에 맞는 팀이 없습니다');

      await click(button('필터 초기화')!);

      expect(searchInput().value).toBe('');
      expect(chip('전체').getAttribute('aria-pressed')).toBe('true');
      expect(container.textContent).toContain('가팀');
      expect(container.textContent).not.toContain('조건에 맞는 팀이 없습니다');
    });

    /**
     * 「다시 시도해 주세요」라고 말하면서 다시 시도할 것을 주지 않던 자리다.
     * 버튼이 있다는 것만으로는 부족하다 — **눌러서 실제로 복구되는지**까지 본다.
     */
    it('조회에 실패하면 같은 자리에서 다시 시도할 수 있고, 눌러 복구된다', async () => {
      listStaffProgramTeamsMock.mockRejectedValueOnce(new Error('boom'));
      listProgramApplicationsMock.mockResolvedValue(page([]));
      await act(async () => {
        root.render(<ProgramStaffTeamsPage programId="program-1" />);
      });

      expect(container.textContent).toContain('참여 팀을 불러오지 못했습니다');
      const retry = button('다시 시도');
      expect(retry).toBeDefined();

      listStaffProgramTeamsMock.mockResolvedValue([
        team('t1', '가팀', [member('a', '김가', true)]),
      ]);
      await click(retry!);

      expect(container.textContent).not.toContain(
        '참여 팀을 불러오지 못했습니다',
      );
      expect(container.textContent).toContain('가팀');
    });

    // 실패는 표의 빈 자리가 아니라 화면 상태다(design.md R-10).
    it('실패 화면은 빈 표 문구를 함께 보여 주지 않는다', async () => {
      listStaffProgramTeamsMock.mockRejectedValue(new Error('boom'));
      listProgramApplicationsMock.mockResolvedValue(page([]));
      await act(async () => {
        root.render(<ProgramStaffTeamsPage programId="program-1" />);
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('아직 참여 팀이 없습니다');
      expect(text).not.toContain('조건에 맞는 팀이 없습니다');
    });
  });

  it('팀명은 그 팀의 팀 상세(#874)로 가는 링크다 — 신청이 없는 팀도 포함한다', async () => {
    await render(
      [
        team('t1', '가팀', [member('a', '김가', true)]),
        team('t2', '나팀', [member('b', '이나', true)]),
      ],
      [application('t1', 'APPROVED')],
    );

    const gaTeamLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === '가팀',
    );
    expect(gaTeamLink?.getAttribute('href')).toBe(
      programTeamDetailHref('program-1', 't1'),
    );
    // 신청이 없는 나팀도 팀 상세로는 갈 수 있다 — 신청 상세로 가는
    // 「검토하기」 링크만 신청 유무에 달려 있다.
    const naTeamLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === '나팀',
    );
    expect(naTeamLink?.getAttribute('href')).toBe(
      programTeamDetailHref('program-1', 't2'),
    );
  });

  it('신청이 있는 팀 행은 그 신청 상세로 가는 「검토하기」 링크를 갖는다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'SUBMITTED')],
    );

    const link = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === REVIEW_ACTION_LABEL,
    );
    expect(link?.getAttribute('href')).toBe(
      programApplicationDetailHref('program-1', 'app-t1'),
    );
  });

  it('신청이 없는 팀 행에는 「검토하기」 링크가 없고, 클릭해도 이동하지 않는다 (팀명 링크는 있다)', async () => {
    await render(
      [
        team('t1', '가팀', [member('a', '김가', true)]),
        team('t2', '나팀', [member('b', '이나', true)]),
      ],
      [application('t1', 'APPROVED')],
    );

    const link = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes(REVIEW_ACTION_LABEL),
    );
    // 신청이 있는 t1 행에만 검토하기 링크가 있다 — 하나뿐이어야 한다.
    expect(link?.getAttribute('href')).toBe(
      programApplicationDetailHref('program-1', 'app-t1'),
    );

    const rows = container.querySelectorAll('tbody tr');
    const noApplicationRow = [...rows].find((row) =>
      row.textContent?.includes('나팀'),
    );
    expect(noApplicationRow).toBeTruthy();
    // 갈 곳이 없는 행은 클릭 가능한 커서도 보이면 안 된다 — 커서만 보고
    // 눌렀는데 아무 일도 안 일어나면 그게 더 헷갈린다.
    expect(noApplicationRow?.className).not.toContain('cursor-pointer');
    await act(async () => {
      noApplicationRow!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('신청이 있는 팀 행을 클릭하면(링크 밖) 그 신청 상세로 이동한다', async () => {
    await render(
      [team('t1', '가팀', [member('a', '김가', true)])],
      [application('t1', 'SUBMITTED')],
    );

    const row = [...container.querySelectorAll('tbody tr')].find((candidate) =>
      candidate.textContent?.includes('가팀'),
    );
    expect(row).toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith(
      programApplicationDetailHref('program-1', 'app-t1'),
    );
  });
});
