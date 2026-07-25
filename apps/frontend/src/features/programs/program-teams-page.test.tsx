import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProgramTeamRosterView,
  ProgramTeamsSetupView,
} from './program-teams-page';
import type { ProgramTeam } from './api';
import type { ProgramDetail } from './types';
import { applyHrefWithTeam, mapTeamError } from './program-teams-flow';

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 팀 프로그램',
  organizer: '합성 주관',
  category: 'OSS_CONTEST',
  description: '설명',
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};

const team: ProgramTeam = {
  id: 'team-1',
  name: '오픈소스팀',
  memberCount: 2,
  minMembers: 2,
  maxMembers: 4,
  locked: false,
  isLeader: true,
  members: [
    {
      userId: 'u1',
      nickname: 'leader',
      name: '팀장',
      isLeader: true,
    },
    {
      userId: 'u2',
      nickname: 'member2',
      name: null,
      isLeader: false,
    },
  ],
};

describe('ProgramTeams views', () => {
  it('만들기·합류 폼을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsSetupView
        program={program}
        createName=""
        joinCode=""
        creating={false}
        joining={false}
        serverError={null}
        onCreateNameChange={() => undefined}
        onJoinCodeChange={() => undefined}
        onCreate={() => undefined}
        onJoin={() => undefined}
      />,
    );

    expect(html).toContain('팀 만들기');
    expect(html).toContain('참여코드로 합류');
    expect(html).toContain('name="teamName"');
    expect(html).toContain('name="joinCode"');
    expect(html).not.toContain('TicketStub');
  });

  it('팀 현황·참여코드·멤버 목록을 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamRosterView
        program={program}
        team={team}
        joinCode="ABCD1234XY"
      />,
    );

    expect(html).toContain('오픈소스팀');
    expect(html).toContain('2/4명');
    expect(html).toContain('ABCD1234XY');
    expect(html).toContain('팀장');
    expect(html).toContain('member2');
    expect(html).toContain('신청서 작성으로 이동');
    expect(html).toContain('/programs/program-1/apply?teamId=team-1');
  });

  it('잠긴 팀을 안내한다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamRosterView
        program={program}
        team={{ ...team, locked: true }}
        joinCode={null}
      />,
    );
    expect(html).toContain('신청 제출 후 팀을 변경할 수 없습니다');
  });

  it('서버 오류를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsSetupView
        program={program}
        createName="팀"
        joinCode=""
        creating={false}
        joining={false}
        serverError="팀 최대 인원을 초과할 수 없습니다."
        onCreateNameChange={() => undefined}
        onJoinCodeChange={() => undefined}
        onCreate={() => undefined}
        onJoin={() => undefined}
      />,
    );
    expect(html).toContain('팀 최대 인원을 초과할 수 없습니다.');
  });
});

describe('program-teams-flow', () => {
  it('TEAM_FULL 등 오류 메시지를 매핑한다', () => {
    expect(
      mapTeamError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'x',
        code: 'TEAM_007',
        instance: '/programs/p/teams/join',
      }),
    ).toBe('팀 최대 인원을 초과할 수 없습니다.');
  });

  it('신청서 링크에 teamId 를 붙인다', () => {
    expect(applyHrefWithTeam('prog:1', 'team:2')).toBe(
      '/programs/prog%3A1/apply?teamId=team%3A2',
    );
  });
});
