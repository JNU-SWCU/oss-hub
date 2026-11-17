import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge';
import { UserProfileCard } from './user-profile-card';

type Profile = Parameters<typeof UserProfileCard>[0]['profile'];

function student(overrides: Partial<Profile> = {}): Profile {
  return {
    name: '합성 학생',
    githubLogin: 'synthetic-student',
    memberKind: 'STUDENT',
    studentId: '260001',
    staffNumber: null,
    department: '소프트웨어공학과',
    participations: [
      {
        programId: 'program-1',
        programName: '합성 프로그램',
        teamName: '합성 팀',
        isLeader: true,
      },
      {
        programId: 'program/2',
        programName: '다른 합성 프로그램',
        teamName: '혼자 하는 팀',
        isLeader: false,
      },
    ],
    ...overrides,
  };
}

function staff(overrides: Partial<Profile> = {}): Profile {
  return {
    name: '합성 교직원',
    githubLogin: 'synthetic-staff',
    memberKind: 'STAFF',
    studentId: null,
    staffNumber: 'STAFF-42',
    department: 'SW중심대학사업단',
    participations: [],
    ...overrides,
  };
}

function render(profile: Profile): string {
  return renderToStaticMarkup(<UserProfileCard profile={profile} />);
}

describe('UserProfileCard — 가입 유형별 항목', () => {
  it('학생은 학번·학과·GitHub·참여 프로그램과 팀을 보여 주고 교직원 항목은 그리지 않는다', () => {
    const html = render(student());

    expect(html).toContain('합성 학생');
    expect(html).toContain('학번');
    expect(html).toContain('260001');
    expect(html).toContain('학과');
    expect(html).toContain('소프트웨어공학과');
    expect(html).toContain('@synthetic-student');
    expect(html).toContain('참여 프로그램·팀');
    expect(html).not.toContain('교직원 번호');
    expect(html).not.toContain('소속');
  });

  it('교직원은 교직원 번호·소속·GitHub를 보여 주고 학생 항목은 그리지 않는다', () => {
    const html = render(staff({ participations: student().participations }));

    expect(html).toContain('합성 교직원');
    expect(html).toContain('교직원 번호');
    expect(html).toContain('STAFF-42');
    expect(html).toContain('소속');
    expect(html).toContain('SW중심대학사업단');
    expect(html).toContain('@synthetic-staff');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('학과');
    expect(html).not.toContain('참여 프로그램·팀');
    expect(html).not.toContain('합성 프로그램');
  });

  it('가입 유형이 없으면 가입 유형 미선택만 보여 준다', () => {
    const html = render(student({ memberKind: null }));

    expect(html).toContain('가입 유형 미선택');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('교직원 번호');
    expect(html).not.toContain('참여 프로그램·팀');
  });
});

describe('UserProfileCard — 참여 프로그램·팀', () => {
  it('프로그램은 개요 주소로 잇고 팀 이름과 팀장 여부를 함께 보여 준다', () => {
    const html = render(student());

    expect(html).toContain('href="/programs/program-1"');
    expect(html).toContain('href="/programs/program%2F2"');
    expect(html).toContain('합성 팀 · 팀장');
    expect(html).toContain('혼자 하는 팀');
    expect(html).not.toContain('혼자 하는 팀 · 팀장');
    expect(html).not.toContain('개인');
  });

  it('참여 프로그램을 받지 못했으면 구역을 그리지 않는다', () => {
    const html = render(student({ participations: null }));

    expect(html).toContain('260001');
    expect(html).not.toContain('참여 프로그램·팀');
    expect(html).not.toContain('참여 프로그램이 없습니다.');
  });

  it('참여한 프로그램이 없으면 없다고 알린다', () => {
    const html = render(student({ participations: [] }));

    expect(html).toContain('참여 프로그램·팀');
    expect(html).toContain('참여 프로그램이 없습니다.');
    expect(html).not.toContain('<ul');
  });
});

describe('UserProfileCard — 머리말', () => {
  it('GitHub 프로필을 새 탭으로 여는 링크를 건다', () => {
    const html = render(student());

    expect(html).toContain('href="https://github.com/synthetic-student"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(
      'aria-label="synthetic-student의 GitHub 프로필 (새 탭에서 열림)"',
    );
  });

  it('이름과 값이 비어 있으면 미등록으로 채우고 로그인 첫 글자를 대신 쓴다', () => {
    const html = render(
      student({ name: '   ', studentId: null, department: '' }),
    );

    expect(html).toContain('이름 미등록');
    expect(html).toContain('>S</span>');
    expect(html.match(/미등록/g)).toHaveLength(3);
  });

  it('기본은 이름 h2와 하위 h3이고 headingTag로 한 단계 내릴 수 있다', () => {
    const standalone = render(student());
    const nested = renderToStaticMarkup(
      <UserProfileCard profile={student()} headingTag="h3" />,
    );

    expect(standalone).toMatch(/<h2[^>]*>합성 학생<\/h2>/);
    expect(standalone).toMatch(/<h3[^>]*>참여 프로그램·팀<\/h3>/);
    expect(nested).toMatch(/<h3[^>]*>합성 학생<\/h3>/);
    expect(nested).toMatch(/<h4[^>]*>참여 프로그램·팀<\/h4>/);
  });

  it('받은 배지를 머리말에 그리고 없으면 자리를 만들지 않는다', () => {
    const withBadges = renderToStaticMarkup(
      <UserProfileCard
        profile={student()}
        badges={<StatusBadge variant="approved">활성</StatusBadge>}
      />,
    );

    expect(withBadges).toContain('data-slot="status-badge"');
    expect(withBadges).toContain('활성');
    expect(render(student())).not.toContain('data-slot="status-badge"');
  });
});
