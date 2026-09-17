// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { programApplicationDetailHref } from '@/lib/program-route';
import { ProgramStaffTeamDetailPage } from './program-staff-team-detail-page';
import type { StaffTeamDetail } from './types';

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
} = vi.hoisted(() => ({
  getStaffProgramTeamDetailMock: vi.fn(),
  publishRepositoryMock: vi.fn(),
  renameProgramTeamMock: vi.fn(),
}));

vi.mock('./api', () => ({
  getStaffProgramTeamDetail: getStaffProgramTeamDetailMock,
  renameProgramTeam: renameProgramTeamMock,
}));

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

const withApplication: StaffTeamDetail = {
  repositoryContributions: null,
  repositoryUrlHistory: { items: [], nextCursor: null },
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
};

const withoutApplication: StaffTeamDetail = {
  repositoryContributions: null,
  repositoryUrlHistory: { items: [], nextCursor: null },
  teamId: 'team-2',
  name: '무신청팀',
  memberCount: 1,
  members: [
    { userId: 'user-c', name: '마바사', nickname: 'login-c', isLeader: true },
  ],
  application: null,
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramStaffTeamDetailPage programId="program-1" teamId="team-1" />,
      );
    });
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

  it('신청이 있으면 신청 상태와 「검토하기」 링크를 보여준다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
    await render();

    expect(container.textContent).toContain('검토 대기');
    const reviewLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === '검토하기',
    );
    expect(reviewLink?.getAttribute('href')).toBe(
      programApplicationDetailHref('program-1', 'app-1'),
    );
  });

  // #1272 — 없는 신청에 배지를 달면 「대기 중인 신청」으로 읽힌다.
  it('신청이 없으면 상태 배지를 그리지 않고 「검토하기」 링크도 없다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withoutApplication);
    await render();

    // 헤더에 남는 것은 수정 아이콘뿐이다 — 상태를 말하는 배지는 없다.
    // (목록 안의 「팀장」 배지는 같은 컴포넌트라 헤더로 범위를 좀힌다.)
    expect(
      container.querySelector(
        '[data-slot="page-header-actions"] [data-slot="status-badge"]',
      ),
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
      const input = document.querySelector<HTMLInputElement>('#team-name');
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
     * 수정은 제목을 대상으로 하고 배지는 신청 상태를 말한다 — 가리키는 것이 다르므로
     * 한 덩어리로 묶지 않는다. 묶으면 연필이 배지를 가리키는 것처럼 읽힌다.
     */
    it('수정은 제목 옆에, 상태 배지는 우측 액션에 따로 선다', async () => {
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
      expect(actions?.textContent).toContain('검토 대기');
    });

    /**
     * 창은 제목·입력칸·버튼만 갖는다. 설명문을 다시 넣으려면 이 시험이 먼저 저지한다 —
     * 버튼이 하는 일을 문장으로 한 번 더 말하는 자리가 여기였다(AP-17).
     */
    it('창은 설명문 없이 입력과 버튼만 갖는다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();
      await openDialog();

      const dialog = document.querySelector('[role="alertdialog"]');
      expect(dialog?.querySelector('p')).toBeNull();
      expect(dialog?.textContent).not.toContain('GitHub');
      expect(dialog?.querySelector('#team-name')).toBeTruthy();
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

    it('빈 이름과 같은 이름은 저장할 수 없다', async () => {
      getStaffProgramTeamDetailMock.mockResolvedValue(withApplication);
      await render();
      await openDialog();

      // 열자마자는 지금 이름이 들어 있다 — 그대로 누르면 바뀔 것이 없다.
      expect(dialogButton('저장')?.disabled).toBe(true);

      await fill('   ');
      expect(dialogButton('저장')?.disabled).toBe(true);

      await fill('다른 이름');
      expect(dialogButton('저장')?.disabled).toBe(false);
      expect(renameProgramTeamMock).not.toHaveBeenCalled();
    });
  });
});
