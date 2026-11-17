import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  MyProfileView,
  type MyProfileState,
} from './components/my-profile-view';
import type { UserProfile } from './types';

function student(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    githubLogin: 'synthetic-student',
    memberKind: 'STUDENT',
    name: '합성 학생',
    studentId: '260001',
    staffNumber: null,
    department: '소프트웨어공학과',
    phone: '1'.repeat(10),
    isComplete: true,
    participations: [
      {
        programId: 'program-1',
        programName: '합성 프로그램',
        teamName: '합성 팀',
        isLeader: true,
      },
      {
        programId: 'program-2',
        programName: '다른 합성 프로그램',
        teamName: '혼자 하는 팀',
        isLeader: false,
      },
    ],
    ...overrides,
  };
}

function staff(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    githubLogin: 'synthetic-staff',
    memberKind: 'STAFF',
    name: '합성 교직원',
    studentId: null,
    staffNumber: 'STAFF-42',
    department: 'SW중심대학사업단',
    phone: '2'.repeat(11),
    isComplete: true,
    participations: [],
    ...overrides,
  };
}

function render(state: MyProfileState): string {
  return renderToStaticMarkup(
    <MyProfileView state={state} onRetry={() => {}} />,
  );
}

function ready(profile: UserProfile): string {
  return render({ kind: 'ready', profile });
}

describe('내 정보 — 가입 유형별 항목', () => {
  it('학생 세션은 학번·학과·GitHub·참여 프로그램과 팀 이름을 보여 준다', () => {
    const html = ready(student());

    expect(html).toMatch(/<h1[^>]*>내 정보<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>합성 학생<\/h2>/);
    expect(html).toContain('학번');
    expect(html).toContain('260001');
    expect(html).toContain('학과');
    expect(html).toContain('소프트웨어공학과');
    expect(html).toContain('href="https://github.com/synthetic-student"');
    expect(html).toContain('href="/programs/program-1"');
    expect(html).toContain('합성 팀 · 팀장');
    expect(html).toContain('href="/programs/program-2"');
    expect(html).toContain('혼자 하는 팀');
    expect(html).not.toContain('개인');
    expect(html).not.toContain('교직원 번호');
  });

  it('교직원 세션은 교직원 번호·소속·GitHub를 보여 주고 학생 항목은 그리지 않는다', () => {
    const html = ready(staff());

    expect(html).toMatch(/<h2[^>]*>합성 교직원<\/h2>/);
    expect(html).toContain('교직원 번호');
    expect(html).toContain('STAFF-42');
    expect(html).toContain('소속');
    expect(html).toContain('SW중심대학사업단');
    expect(html).toContain('href="https://github.com/synthetic-staff"');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('참여 프로그램');
  });

  it.each([
    ['학생', student()],
    ['교직원', staff()],
  ])('%s 본인 화면에는 관리자 구역과 권한·계정 배지가 없다', (_, profile) => {
    const html = ready(profile);

    expect(html).not.toContain('관리자 전용');
    expect(html).not.toContain('<aside');
    expect(html).not.toContain('data-slot="status-badge"');
    expect(html).not.toContain('프로필 수정');
  });
});

describe('내 정보 — 비어 있거나 긴 값', () => {
  it('참여 프로그램이 없는 학생에게는 없다고 알린다', () => {
    const html = ready(student({ participations: [] }));

    expect(html).toContain('참여 프로그램이 없습니다.');
    expect(html).not.toContain('<ul');
  });

  it('가입 유형이 없으면 유형별 항목 없이 가입 유형 미선택만 보여 준다', () => {
    const html = ready(staff({ memberKind: null }));

    expect(html).toContain('가입 유형 미선택');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('교직원 번호');
    expect(html).not.toContain('참여 프로그램');
  });

  it('긴 이름·소속·프로그램·팀 이름을 자르지 않고 모두 싣는다', () => {
    const name = `${'가나다라마바사'.repeat(8)} Synthetic-Long-Name`;
    const department = '합성 긴 소속 이름 '.repeat(8).trim();
    const programName = 'UnbrokenProgramName'.repeat(6);
    const teamName = 'TeamNameWithoutSpaces'.repeat(4);
    const html = ready(
      student({
        name,
        department,
        participations: [
          { programId: 'program-long', programName, teamName, isLeader: true },
        ],
      }),
    );

    expect(html).toContain(name);
    expect(html).toContain(department);
    expect(html).toContain(programName);
    expect(html).toContain(`${teamName} · 팀장`);
  });
});

describe('내 정보 — 정보 수정과 조회 상태', () => {
  it.each([
    ['불러오는 중', { kind: 'loading' }],
    ['조회 실패', { kind: 'error' }],
    ['조회 완료', { kind: 'ready', profile: student() }],
  ] satisfies [string, MyProfileState][])(
    '%s 상태에서도 제목과 설정으로 가는 정보 수정 링크를 유지한다',
    (_, state) => {
      const html = render(state);

      expect(html).toMatch(/<h1[^>]*>내 정보<\/h1>/);
      expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>.*정보 수정<\/a>/);
    },
  );

  it('불러오는 중에는 카드 대신 진행 상태를 알린다', () => {
    const html = render({ kind: 'loading' });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-slot="user-profile-card"');
    expect(html).not.toContain('data-slot="failure-state"');
  });

  it('조회에 실패하면 카드 없이 실패와 다시 시도를 보여 준다', () => {
    const html = render({ kind: 'error' });

    expect(html).toContain('data-slot="failure-state"');
    expect(html).toMatch(/<button[^>]*>.*다시 시도<\/button>/);
    expect(html).not.toContain('data-slot="user-profile-card"');
    expect(html).not.toContain('참여 프로그램이 없습니다.');
  });
});
