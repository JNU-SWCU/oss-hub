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

const { getStaffProgramTeamDetailMock } = vi.hoisted(() => ({
  getStaffProgramTeamDetailMock: vi.fn(),
}));

vi.mock('./api', () => ({
  getStaffProgramTeamDetail: getStaffProgramTeamDetailMock,
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

  it('신청이 없으면 미신청으로 표시하고 「검토하기」 링크가 없다', async () => {
    getStaffProgramTeamDetailMock.mockResolvedValue(withoutApplication);
    await render();

    expect(container.textContent).toContain('미신청');
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
          url: 'https://github.com/org/repo',
          visibility: 'PUBLIC',
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
});
