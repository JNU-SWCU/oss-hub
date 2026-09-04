import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProgramTeamRosterView,
  ProgramTeamsDirectory,
  ProgramTeamsSetupView,
  type ProgramTeamDirectoryEntry,
} from './program-teams-page';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ProgramDetail } from './types';
import {
  applyHrefWithTeam,
  mapInvitationError,
  mapTeamActionError,
  mapTeamError,
} from './program-teams-flow';

function problem(code: string, status: number): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'Error',
    status,
    detail: '',
    code,
    instance: '/programs/p/teams',
  };
}

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 팀 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  description: '설명',
  repositoryProvisioningEnabled: true,
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
    expect(html).toContain('참여 코드로 합류');
    // 표기는 "참여 코드"로 통일한다 — 붙여 쓴 표기가 남으면 화면마다 갈린다(#355).
    expect(html).not.toContain('참여코드');
    expect(html).toContain('name="teamName"');
    expect(html).toContain('name="joinCode"');
    expect(html).not.toContain('TicketStub');
  });

  it('팀 현황·참여 코드·멤버 목록을 표시한다', () => {
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
    expect(html).toContain('참여 코드');
    expect(html).not.toContain('참여코드');
    expect(html).toContain('팀장');
    expect(html).toContain('member2');
    expect(html).toContain('신청서 작성');
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
    expect(html).toContain('신청서 확인');
    expect(html).not.toContain('신청서 작성');
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

  it('team-invitations 오류 코드를 매핑한다', () => {
    expect(
      mapInvitationError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'x',
        code: 'TIV_009',
        instance: '/team-invitations/teams/t/invitations',
      }),
    ).toBe('팀 최대 인원을 초과할 수 없습니다.');

    expect(
      mapInvitationError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: '알 수 없는 오류',
        code: 'TIV_999',
        instance: '/team-invitations/x/accept',
      }),
    ).toBe('알 수 없는 오류');
  });

  // #355 — 판정 기준은 "읽은 사람이 다음에 무엇을 할 수 있는지 아는가"다.
  // 실패만 알리고 끝나는 문구가 다시 들어오지 못하도록 문장을 통째로 고정한다.
  it('참여 코드를 못 찾으면 어디서 코드를 다시 받는지 알려 준다', () => {
    expect(mapTeamError(problem('TEAM_009', 404))).toBe(
      '참여 코드를 찾을 수 없습니다. 팀장에게 받은 코드를 다시 확인해 주세요.',
    );
  });

  it('코드를 모르는 팀 오류도 다시 시도해도 되는 상황인지 알려 준다', () => {
    expect(mapTeamError(problem('TEAM_999', 500))).toBe(
      '팀 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });

  it('ApiError 가 아닌 만들기 실패는 확인할 입력으로 팀 이름을 지목한다', () => {
    expect(mapTeamActionError(new TypeError('network'), 'create')).toBe(
      '팀을 만들지 못했습니다. 팀 이름을 확인한 뒤 다시 시도해 주세요.',
    );
  });

  it('ApiError 가 아닌 합류 실패는 가장 흔한 원인인 참여 코드를 지목한다', () => {
    expect(mapTeamActionError(new TypeError('network'), 'join')).toBe(
      '팀에 합류하지 못했습니다. 참여 코드가 맞는지 확인한 뒤 다시 시도해 주세요.',
    );
  });

  it('ApiError 는 동작과 무관하게 서버가 짚어 준 원인을 그대로 쓴다', () => {
    const error = new ApiError(problem('TEAM_007', 409));
    expect(mapTeamActionError(error, 'create')).toBe(
      '팀 최대 인원을 초과할 수 없습니다.',
    );
    expect(mapTeamActionError(error, 'join')).toBe(
      '팀 최대 인원을 초과할 수 없습니다.',
    );
  });
});

describe('ProgramTeamsDirectory', () => {
  const teams: ProgramTeamDirectoryEntry[] = [
    {
      teamId: 'team-1',
      name: '오픈소스 4조',
      memberCount: 2,
      members: [
        { userId: 'u1', displayName: '팀장닉', isLeader: true },
        { userId: 'u2', displayName: '팀원닉', isLeader: false },
      ],
    },
    {
      teamId: 'team-2',
      name: '오픈소스 5조',
      memberCount: 1,
      members: [{ userId: 'u3', displayName: '다른팀장', isLeader: true }],
    },
  ];

  it('전체 팀과 멤버·팀장 표시를 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsDirectory teams={teams} myTeamId="team-1" />,
    );

    expect(html).toContain('참여 팀');
    expect(html).toContain('팀 구성과 인원만 공개됩니다');
    expect(html).toContain('저장소는 비공개');
    expect(html).toContain('오픈소스 4조 (내 팀)');
    expect(html).toContain('오픈소스 5조');
    expect(html).not.toContain('오픈소스 5조 (내 팀)');
    expect(html).toContain('2명 · ★ 팀장');
    expect(html).toContain('팀장닉 ★');
    expect(html).toContain('팀원닉');
    expect(html).not.toContain('팀원닉 ★');
    const teamsWithoutRepoLabel = (html.match(/GitHub 저장소 비공개/g) ?? [])
      .length;
    expect(teamsWithoutRepoLabel).toBe(2);
  });

  it('개인 소속 팀이 없으면 표시가 붙지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsDirectory teams={teams} myTeamId={null} />,
    );
    expect(html).not.toContain('(내 팀)');
  });

  it('팀이 없으면 빈 상태를 보여준다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsDirectory teams={[]} myTeamId={null} />,
    );
    expect(html).toContain('아직 구성된 팀이 없습니다');
  });
});
