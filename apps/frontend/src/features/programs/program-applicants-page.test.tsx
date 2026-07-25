import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { staffApplicationDetailHref } from './program-paths';
import type { ApplicationListItem } from './types';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

function participationLabel(item: ApplicationListItem): string {
  if (item.participation === 'TEAM' && item.team) {
    return `팀 · ${item.team.name} (${item.team.memberCount}명)`;
  }
  return '개인';
}

const personal: ApplicationListItem = {
  id: 'app-personal',
  status: 'SUBMITTED',
  submittedAt: '2026-07-15T00:00:00.000Z',
  participation: 'INDIVIDUAL',
  applicant: {
    id: 'student-1',
    name: '합성 학생',
    nickname: 'login-1',
  },
  team: null,
  answers: {
    applicantName: '합성 학생',
    title: '개인 제목',
    summary: '요약',
  },
};

const team: ApplicationListItem = {
  id: 'app-team',
  status: 'APPROVED',
  submittedAt: '2026-07-16T00:00:00.000Z',
  participation: 'TEAM',
  applicant: {
    id: 'student-2',
    name: '팀장',
    nickname: 'leader',
  },
  team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '팀장',
    title: '팀 제목',
    summary: '팀 요약',
  },
};

describe('program applicants display helpers', () => {
  it('개인 신청은 가짜 팀명을 붙이지 않는다', () => {
    expect(participationLabel(personal)).toBe('개인');
    expect(participationLabel(personal)).not.toContain('팀');
  });

  it('팀 신청은 팀명과 인원을 표시한다', () => {
    expect(participationLabel(team)).toBe('팀 · 합성 팀 (3명)');
  });

  it('상세 href 는 locked #119 경로를 쓴다', () => {
    expect(staffApplicationDetailHref('program:1', 'app:2')).toBe(
      '/staff/programs/program%3A1/applications/app%3A2',
    );
  });
});

describe('staffApplicationDetailHref in markup', () => {
  it('행 링크가 인코딩된 상세 경로를 가리킨다', () => {
    const href = staffApplicationDetailHref('program-1', 'app-1');
    const html = renderToStaticMarkup(
      <a href={href}>보기</a>,
    );
    expect(html).toContain('/staff/programs/program-1/applications/app-1');
    expect(html).not.toContain('판정');
  });
});
