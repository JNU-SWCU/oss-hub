// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { ProgramStaffTeamDetailPage } from './program-staff-team-detail-page';
import { updateTeamRepositoryUrl } from './repository-url-api';
import { getTeamActivity, type TeamActivity } from './team-activity-api';
import type { ApplicationDetail, StaffTeamDetail } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const {
  getStaffProgramTeamDetailMock,
  publishRepositoryMock,
  renameProgramTeamMock,
  deleteStaffProgramTeamMock,
  getApplicationDetailWithHistoryMock,
  decideApplicationMock,
  routerPushMock,
} = vi.hoisted(() => ({
  getApplicationDetailWithHistoryMock: vi.fn(),
  decideApplicationMock: vi.fn(),
  getStaffProgramTeamDetailMock: vi.fn(),
  publishRepositoryMock: vi.fn(),
  renameProgramTeamMock: vi.fn(),
  deleteStaffProgramTeamMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('./api', () => ({
  getStaffProgramTeamDetail: getStaffProgramTeamDetailMock,
  renameProgramTeam: renameProgramTeamMock,
  deleteStaffProgramTeam: deleteStaffProgramTeamMock,
  getApplicationDetailWithHistory: getApplicationDetailWithHistoryMock,
  decideApplication: decideApplicationMock,
}));

vi.mock('./team-activity-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-activity-api')>()),
  getTeamActivity: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));

vi.mock('./repository-url-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository-url-api')>()),
  updateTeamRepositoryUrl: vi.fn(),
}));

/** recharts는 크기를 재야 그린다 — 이 화면 테스트는 그래프가 서는지만 본다. */
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div data-chart="">{children}</div>
  );
  const Nothing = () => null;
  return {
    CartesianGrid: Nothing,
    Line: Nothing,
    LineChart: Pass,
    ReferenceLine: Nothing,
    ResponsiveContainer: Pass,
    XAxis: Nothing,
    YAxis: Nothing,
  };
});

vi.mock('@/lib/repository-publication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/repository-publication')>()),
  publishRepository: publishRepositoryMock,
}));

function problem(status: number, code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'detail',
    instance: 'urn:test:teams:team-1',
    code,
  };
}

/** 신청서 본문과 검토 이력. 팀 상세 응답은 요약만 주므로 화면이 따로 읽는다. */
const APPLICATION_DETAIL = {
  id: 'app-1',
  status: 'SUBMITTED',
  rejectionReason: null,
  answers: {
    applicantName: '합성 신청자',
    summary: '합성 지원 동기와 계획입니다.',
  },
  applicant: { id: 'user-a', name: '합성 신청자', nickname: 'login-a' },
  reviewHistory: [
    {
      id: 'h2',
      eventKind: 'REJECTED',
      revision: 1,
      actor: { name: '합성 교직원', nickname: 'staff-a' },
      occurredAt: '2026-08-06T01:00:00.000Z',
      rejectionReason: '서류가 비어 있습니다.',
    },
    {
      id: 'h1',
      eventKind: 'SUBMITTED',
      revision: 1,
      actor: { name: '합성 신청자', nickname: 'login-a' },
      occurredAt: '2026-08-05T05:32:00.000Z',
      rejectionReason: null,
    },
  ],
} as unknown as ApplicationDetail;

/** 학생 「우리 팀」과 같은 조회 — 교직원은 저장 경로와 편집 권한만 다르다. */
const teamActivity: TeamActivity = {
  applicationId: 'app-1',
  repository: null,
  status: 'NOT_CONNECTED',
  lastSuccessAt: null,
  window: { from: '2026-08-03', to: '2026-08-16', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: true,
  members: [],
};

const withApplication: StaffTeamDetail = {
  teamId: 'team-1',
  name: '오픈소스팀',
  memberCount: 2,
  members: [
    { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
    { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
  ],
  application: {
    id: 'app-1',
    status: 'SUBMITTED',
    repositoryConnectionMode: 'NEW',
    repository: null,
    repositoryProvisioning: {
      enabled: true,
      jobStatus: 'NOT_REQUESTED',
      updatedAt: '2026-08-01T00:00:00.000Z',
      safeErrorClass: null,
    },
  },
  deletionScope: {
    applications: 1,
    members: 2,
    invitations: 0,
    submissions: 0,
    submissionEvents: 0,
    detachedRepositories: 0,
    scopeFingerprint: '0123456789abcdef0123456789abcdef',
  },
};

const withoutApplication: StaffTeamDetail = {
  teamId: 'team-2',
  name: '무신청팀',
  memberCount: 1,
  members: [
    { userId: 'user-c', name: '마바사', nickname: 'login-c', isLeader: true },
  ],
  application: null,
  deletionScope: {
    applications: 0,
    members: 1,
    invitations: 0,
    submissions: 0,
    submissionEvents: 0,
    detachedRepositories: 0,
    scopeFingerprint: 'fedcba9876543210fedcba9876543210',
  },
};

describe('ProgramStaffTeamDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getStaffProgramTeamDetailMock.mockReset();
    publishRepositoryMock.mockReset();
    renameProgramTeamMock.mockReset();
    deleteStaffProgramTeamMock.mockReset();
    routerPushMock.mockReset();
    getApplicationDetailWithHistoryMock.mockReset();
    getApplicationDetailWithHistoryMock.mockResolvedValue(APPLICATION_DETAIL);
    decideApplicationMock.mockReset();
    decideApplicationMock.mockResolvedValue({});
    vi.mocked(getTeamActivity).mockReset().mockResolvedValue(teamActivity);
    vi.mocked(updateTeamRepositoryUrl).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramStaffTeamDetailPage
          programId="program-1"
          teamId="team-1"
          sessionKey="synthetic-staff"
        />,
      );
    });
  }

  /** 접힌 줄은 둘이다(저장소 URL 변경 이력·검토 이력) — 검토 이력은 글자로 찾는다. */
  function reviewHistoryTrigger(): HTMLButtonElement | undefined {
    return [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-slot="collapsible-trigger"]',
      ),
    ].find((trigger) => trigger.textContent?.includes('검토 이력'));
  }

  /**
   * 인원수는 명단이 있는 섹션이 말한다. 제목 아래에 두면 「한빛 팀 / 팀원 3명 /
   * 팀원」으로 한 눈에 「팀」이 세 번 선다.
   */
  it('인원수는 머리말이 아니라 팀원 섹션이 말한다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    expect(
      container.querySelector('[data-slot="page-header-description"]'),
    ).toBeNull();
    const memberSection = [...container.querySelectorAll('section')].find(
      (section) => section.textContent?.includes('팀원'),
    );
    expect(memberSection?.textContent).toContain('2명');
  });

  it('팀원 이름과 팀장 표시를 보여준다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    expect(container.textContent).toContain('가나다');
    // 프로필이 비어 있는(name: null) 팀원은 GitHub 계정으로 떨어진다.
    expect(container.textContent).toContain('login-b');
    expect(container.textContent).toContain('팀장');
  });

  /**
   * 상태는 제목 옆 드롭다운 하나다. 별도 상세로 보내던 「검토하기」와 신청서
   * 본문·지원 동기는 이 화면에 없다.
   */
  it('신청이 있으면 제목 옆에서 상태를 바꾸고 검토 이력을 접어 둔다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    const select = container.querySelector<HTMLSelectElement>(
      '#team-detail-application-status',
    );
    expect(select?.value).toBe('SUBMITTED');
    expect(select?.getAttribute('data-variant')).toBe('pending');
    expect(select?.className).toContain('bg-status-pending-bg');
    // 누르는 컨트롤이라 Select 기본 44px(h-control)이다. 배지 높이(h-tag)가 섞이면 cn이 h-control을 지운다.
    expect(select?.className).toContain('h-control');
    expect(
      container.querySelector(
        '[data-slot="page-header-actions"] [data-slot="select"]',
      ),
    ).toBe(select);
    expect(
      container.querySelectorAll('[data-slot="status-badge"]').length,
    ).toBe(1);
    expect(
      container.querySelector('[data-slot="status-badge"]')?.textContent,
    ).toBe('팀장');
    expect(container.textContent).toContain('검토 이력');
    expect(container.textContent).not.toContain('신청서');
    expect(container.textContent).not.toContain('합성 지원 동기');
    expect(container.textContent).not.toContain('내용 보기');
    const reviewLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === '검토하기',
    );
    expect(reviewLink).toBeUndefined();

    const historyTrigger = reviewHistoryTrigger();
    expect(historyTrigger).toBeInstanceOf(HTMLButtonElement);
    expect(historyTrigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('신청서 본문과 지원 동기를 그리지 않는다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    expect(container.textContent).not.toContain('합성 지원 동기');
    expect(container.textContent).not.toContain('지원 동기');
    expect(container.textContent).not.toContain('내용 보기');
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '내용 보기',
      ),
    ).toBeUndefined();
  });

  it('검토 이력은 접혀 있고 펼치면 서버가 준 순서 그대로 그린다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    const trigger = reviewHistoryTrigger();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger?.click());

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const history = document.getElementById(
      trigger?.getAttribute('aria-controls') ?? '',
    );
    const text = history?.textContent ?? '';
    // 서버가 최신순으로 준다 — 화면이 다시 정렬하면 이 순서가 뒤집힌다.
    expect(text.indexOf('반려')).toBeLessThan(text.indexOf('제출'));
  });

  it.each(['SUBMITTED', 'APPROVED', 'REJECTED'] as const)(
    '%s 에서도 세 상태를 전부 고를 수 있다',
    async (status) => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      getApplicationDetailWithHistoryMock.mockResolvedValue({
        ...APPLICATION_DETAIL,
        status,
      });
      await render();

      const select = container.querySelector<HTMLSelectElement>(
        '#team-detail-application-status',
      );
      expect(select?.value).toBe(status);
      expect(select?.disabled).toBe(false);
      expect([...(select?.options ?? [])].every((o) => !o.disabled)).toBe(true);
    },
  );

  it('반려는 사유 없이 바로 보내지 않고 확인창을 연다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    const select = container.querySelector<HTMLSelectElement>(
      '#team-detail-application-status',
    );
    await act(async () => {
      if (select) {
        select.value = 'REJECTED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(decideApplicationMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  });

  // #1272 — 없는 신청에 상태를 달면 「대기 중인 신청」으로 읽힌다.
  it('신청이 없으면 상태 조작을 그리지 않고 「검토하기」 링크도 없다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withoutApplication);
    await render();

    // 헤더에 남는 것은 수정 아이콘뿐이다 — 상태를 말하는 조작은 없다.
    expect(
      container.querySelector('[data-slot="page-header-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('#team-detail-application-status'),
    ).toBeNull();
    expect(container.textContent).not.toContain('미신청');
    expect(container.textContent).not.toContain('신청 없음');
    expect(container.textContent).not.toContain('검토 대기');
    const reviewLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === '검토하기',
    );
    expect(reviewLink).toBeUndefined();
  });

  it('저장소가 있으면 저장소 링크를 보여준다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue({
      ...withApplication,
      application: {
        ...withApplication.application!,
        status: 'APPROVED',
        repository: {
          id: 'repository-1',
          url: 'https://github.com/org/repo',
          visibility: 'PUBLIC',
          publishEligible: true,
          blockedReasons: [],
        },
      },
    });
    await render();

    const repoLink = [...container.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === 'https://github.com/org/repo',
    );
    expect(repoLink).toBeTruthy();
    expect(container.textContent).toContain('공개');
  });

  it('NEW 저장소가 공개 조건을 충족하면 팀 상세에서 공개 전환할 수 있다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue({
      ...withApplication,
      application: {
        ...withApplication.application!,
        status: 'APPROVED',
        repository: {
          id: 'repository-1',
          url: 'https://github.com/org/repo',
          visibility: 'PRIVATE',
          publishEligible: true,
          blockedReasons: [],
        },
      },
    });
    publishRepositoryMock.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: 'PUBLIC',
      publishedAt: '2026-08-13T00:00:00.000Z',
    });
    await render();

    const publishButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'GitHub 저장소 공개 전환',
    );
    expect(publishButton?.disabled).toBe(false);
    await act(async () => publishButton?.click());

    expect(publishRepositoryMock).toHaveBeenCalledWith('repository-1');
    expect(container.textContent).toContain('PUBLIC');
    expect(container.textContent).toContain('공개 저장소 열기');
  });

  it('외부 OWN 저장소에는 공개 전환 카드를 표시하지 않는다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue({
      ...withApplication,
      application: {
        ...withApplication.application!,
        repositoryConnectionMode: 'OWN',
        repository: {
          id: 'repository-own',
          url: 'https://github.com/student/repo',
          visibility: 'PUBLIC',
          publishEligible: true,
          blockedReasons: [],
        },
      },
    });
    await render();

    expect(container.textContent).not.toContain('저장소 공개');
    expect(container.textContent).not.toContain('GitHub 저장소 공개 전환');
  });

  it('없는 팀(404)이면 찾을 수 없다는 안내를 보여준다', async () => {
    getStaffProgramTeamDetailMock.mockRejectedValue(
      new ApiError(problem(404, 'TEAM_010')),
    );
    await render();

    expect(container.textContent).toContain('팀을 찾을 수 없습니다');
  });

  it('그 외 오류는 일반 오류 안내를 보여준다', async () => {
    getStaffProgramTeamDetailMock.mockRejectedValue(new Error('boom'));
    await render();

    expect(container.textContent).toContain('팀 상세를 열 수 없습니다');
  });

  describe('저장소 카드 — 학생과 같은 조회', () => {
    const connected: TeamActivity = {
      ...teamActivity,
      repository: { id: 'repository-1', url: 'https://github.com/org/repo' },
      status: 'NOT_COLLECTED',
    };

    it('학생과 같은 조회로 URL 줄·그래프를 그리고 목록형 활동은 두지 않는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      vi.mocked(getTeamActivity).mockResolvedValue(connected);
      await render();

      expect(getTeamActivity).toHaveBeenCalledExactlyOnceWith(
        'program-1',
        'team-1',
      );
      const card = container.querySelector(
        'section[aria-label="프로젝트 저장소"]',
      );
      expect(card?.querySelector('a')?.getAttribute('href')).toBe(
        'https://github.com/org/repo',
      );
      expect(
        card?.querySelector<HTMLButtonElement>(
          'button[aria-label="저장소 URL 수정"]',
        )?.disabled,
      ).toBe(false);
      expect(container.querySelector('[role="region"] h2')?.textContent).toBe(
        '팀 활동',
      );
      expect(container.textContent).toContain('첫 수집을 기다리는 중입니다');
      expect(container.textContent).not.toContain('현재 저장소 활동');
      expect(container.textContent).not.toContain('웹 참여자와 연결되지 않음');
    });

    it('연필로 바꾸면 팀 경로로 저장하고 상세를 조용히 다시 읽는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      vi.mocked(getTeamActivity)
        .mockResolvedValueOnce(connected)
        .mockResolvedValue({
          ...connected,
          repository: {
            id: 'repository-2',
            url: 'https://github.com/org/next',
          },
        });
      vi.mocked(updateTeamRepositoryUrl).mockResolvedValue({
        repositoryUrl: 'https://github.com/org/next',
        canEditRepositoryUrl: true,
      });
      await render();

      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="저장소 URL 수정"]',
          )
          ?.click(),
      );
      const input =
        container.querySelector<HTMLInputElement>('#repository-url');
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, 'https://github.com/org/next');
        input?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        container
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          ),
      );

      expect(updateTeamRepositoryUrl).toHaveBeenCalledExactlyOnceWith(
        'program-1',
        'team-1',
        { repositoryUrl: 'https://github.com/org/next' },
      );
      // 발급·공개 카드가 옛 저장소를 가리키지 않게 상세를 다시 읽되, 스켈레톤으로 갈지 않는다.
      expect(getStaffProgramTeamDetailMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('저장소 변경을 저장했습니다.');
      expect(
        container
          .querySelector('section[aria-label="프로젝트 저장소"] a')
          ?.getAttribute('href'),
      ).toBe('https://github.com/org/next');
    });

    it('발급 전 팀은 URL 줄 아래에 발급 상태를 말한다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();

      expect(container.textContent).toContain('연결된 저장소가 없습니다.');
      expect(container.textContent).toContain('저장소 발급 요청 전');
    });

    it('바꿀 수 없으면 연필을 잠그고 이유를 URL 줄 아래에 말한다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      vi.mocked(getTeamActivity).mockResolvedValue({
        ...teamActivity,
        canEditRepositoryUrl: false,
      });
      await render();

      const pencil = container.querySelector<HTMLButtonElement>(
        'button[aria-label="저장소 URL 수정"]',
      );
      expect(pencil?.disabled).toBe(true);
      expect(container.textContent).toContain(
        '승인된 팀만 프로그램 종료 전까지 변경할 수 있습니다.',
      );
    });
  });

  /**
   * 팀명을 고치는 자리는 이 화면이다 — 제목이 곧바로 팀명이고, 팀을 단위로
   * 다루는 유일한 화면이다. 창은 Portal로 나가므로 `document` 기준으로 찾는다.
   */
  describe('팀명 수정', () => {
    /**
     * 보조 액션이라 글자가 아니라 아이콘이다(design.md R-27). 그래서 찾는 기준도
     * 보이는 글자가 아니라 접근 가능한 이름이고, 그 이름은 팀마다 고유해야 한다.
     */
    function renameTrigger(name = '오픈소스팀'): HTMLButtonElement | undefined {
      return [...container.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === `${name} 수정`,
      );
    }

    function dialogButton(label: string): HTMLButtonElement | undefined {
      return [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === label,
      );
    }

    async function openDialog(): Promise<void> {
      await act(async () => renameTrigger()?.click());
    }

    async function fill(value: string): Promise<void> {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="팀 이름"]',
      );
      await act(async () => {
        if (input === null) return;
        // React가 듣는 것은 native setter 뒤에 오는 input 이벤트다.
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    it('신청이 없는 팀에도 수정 입구가 있다', async () => {
      // 팀명은 신청과 무관하게 팀의 값이다 — 신청 전에도 고칠 수 있어야 한다.
      getStaffProgramTeamDetailMock.mockResolvedValue(withoutApplication);
      await render();

      expect(renameTrigger('무신청팀')).toBeTruthy();
    });

    // 아이콘만 남기는 대신 이름을 잃으면 읽어 주는 도구에게는 빈 버튼이 된다.
    it('아이콘 버튼은 팀명을 담은 접근 가능한 이름을 갖는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();

      const trigger = renameTrigger();
      expect(trigger?.getAttribute('aria-label')).toBe('오픈소스팀 수정');
      // 글자를 그리지 않는다 — 그렸다면 아이콘이 이미 말한 것을 또 말하는 것이다.
      expect(trigger?.textContent?.trim()).toBe('');
    });

    /**
     * 수정은 제목을 대상으로 하고 상태 조작은 신청을 말한다 — 가리키는 것이
     * 다르므로 한 덩어리로 묶지 않는다. 묶으면 연필이 상태를 가리키는 것처럼
     * 읽힌다.
     */
    it('수정은 제목 옆에, 상태 조작은 우측 액션에 따로 선다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();

      const titleAction = container.querySelector(
        '[data-slot="page-header-title-action"]',
      );
      const actions = container.querySelector(
        '[data-slot="page-header-actions"]',
      );
      expect(titleAction?.contains(renameTrigger() ?? null)).toBe(true);
      expect(actions?.contains(renameTrigger() ?? null)).toBe(false);
      expect(
        actions?.querySelector('#team-detail-application-status'),
      ).toBeTruthy();
      expect(actions?.textContent).toContain('검토 대기');
    });

    /**
     * 창은 제목·입력칸·버튼만 갖는다. 설명문을 다시 넣으려면 이 시험이 먼저 저지한다 —
     * 버튼이 하는 일을 문장으로 한 번 더 말하는 자리가 여기였다(AP-17).
     *
     * 보이는 라벨도 두지 않는다 — 제목이 「팀 이름 변경」이고 칸이 하나뿐이라 라벨은
     * 제목을 다시 말하는 자리가 된다. 이름은 `aria-label`로 남는다.
     */
    it('창은 설명문·보이는 라벨 없이 입력과 버튼만 갖는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();
      await openDialog();

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).not.toContain('GitHub');
      expect(dialog?.querySelector('label')).toBeNull();
      expect(dialog?.querySelector('input[aria-label="팀 이름"]')).toBeTruthy();
    });

    it('새 이름으로 저장하면 제목과 알림이 바뀐 이름을 말한다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      renameProgramTeamMock.mockResolvedValue({
        teamId: 'team-1',
        name: '새팀이름',
      });
      await render();
      await openDialog();
      await fill('  새팀이름  ');
      await act(async () => dialogButton('저장')?.click());

      // 앞뒤 공백은 보내기 전에 떼다 — 백엔드가 trim 한 것과 같은 값이어야 한다.
      expect(renameProgramTeamMock).toHaveBeenCalledWith(
        'program-1',
        'team-1',
        '새팀이름',
      );
      expect(container.textContent).toContain('팀 이름을 바꿨습니다');
      expect(container.textContent).toContain('새팀이름');
      expect(container.textContent).not.toContain('오픈소스팀');
      // 이름 하나 바꾸려고 상세를 통째 다시 읽지 않는다(화면이 스켈레톤으로 돌아간다).
      expect(getStaffProgramTeamDetailMock).toHaveBeenCalledTimes(1);
    });

    it('저장이 실패하면 창 안에서 말하고 제목은 그대로 둔다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      renameProgramTeamMock.mockRejectedValue(
        new ApiError({
          ...problem(403, 'TEAM_016'),
          detail: '팀장 또는 교직원만 팀 이름을 바꿀 수 있습니다.',
        }),
      );
      await render();
      await openDialog();
      await fill('새팀이름');
      await act(async () => dialogButton('저장')?.click());

      expect(document.body.textContent).toContain(
        '팀장 또는 교직원만 팀 이름을 바꿀 수 있습니다.',
      );
      expect(container.textContent).toContain('오픈소스팀');
      expect(container.textContent).not.toContain('팀 이름을 바꿨습니다');
    });

    /**
     * 누르기 전에 붉게 굴지 않는다. 누른 뒤에만 무엇이 모자란지 말한다 —
     * 일정 창(`program-schedule-range-dialog`)이 쓰는 `attempted` 규칙과 같다.
     */
    it('빈 이름으로 저장하면 창 안에서 이유를 말하고 요청하지 않는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();
      await openDialog();

      expect(document.body.textContent).not.toContain(
        '팀 이름을 입력해 주세요',
      );

      await fill('   ');
      await act(async () => dialogButton('저장')?.click());

      expect(document.body.textContent).toContain('팀 이름을 입력해 주세요');
      expect(renameProgramTeamMock).not.toHaveBeenCalled();
      // 창은 열려 있다 — 고칠 자리를 뺏지 않는다.
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    /**
     * 같은 이름은 바뀔 것이 없다. 백엔드도 같은 이름에는 쓰기도 감사도 남기지 않으므로
     * 요청을 보내지 않고 창만 닫는 편이 그 판단과 같다.
     */
    it('같은 이름으로 저장하면 요청 없이 창만 닫는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();
      await openDialog();
      await act(async () => dialogButton('저장')?.click());

      expect(renameProgramTeamMock).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      // 바뀐 것이 없으므로 「바꿨습니다」라고 말하지 않는다.
      expect(container.textContent).not.toContain('팀 이름을 바꿨습니다');
    });
  });

  describe('팀 삭제', () => {
    it('위험 영역에 팀 삭제 버튼이 있고 누르면 확인 창이 열린다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();

      const trigger = [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '팀 삭제',
      );
      expect(trigger).toBeTruthy();
      expect(trigger?.className).toContain('destructive');
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();

      await act(async () => trigger?.click());

      const dialog = document.querySelector('[role="alertdialog"]');
      expect(dialog?.textContent).toContain('팀을 삭제할까요?');
      expect(dialog?.textContent).toContain('지원서 1건 · 팀원 2명');
      expect(dialog?.textContent).toContain(
        '연결된 GitHub 저장소는 삭제하지 않고 연결만 해제합니다.',
      );
    });
  });
});
