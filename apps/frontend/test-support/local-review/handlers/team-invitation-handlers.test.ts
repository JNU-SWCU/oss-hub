import { describe, expect, it } from 'vitest';
import type { ProgramTeam, TeamMember } from '@/features/programs/api';
import type {
  InvitationCandidate,
  ReceivedTeamInvitation,
  SentTeamInvitation,
} from '@/features/programs/team-invitation-api';
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import { localReviewSessionState } from '../handler-kit';
import {
  resetLocalReviewFixtureState,
  resolveLocalReviewResponse,
} from '../fixture-response';
import { rememberProgramTeam } from './student-handlers';
import { STUDENT_TEAM_ID } from './team-invitation-fixtures';

/**
 * 초대 규칙이 **상태를 옮기는지**를 고정한다. 화면 세 자리(헤더 폴링·「우리 팀」·
 * 신청 화면)가 같은 세션 상태를 읽으므로, 한 번의 조작이 다음 조회에서 사라지면
 * 검토자는 제품 결함으로 오해한다.
 *
 * 권한은 서버가 계산해 준 능력 플래그(`canInvite`)만 따른다 — 신청 이력이나
 * 보낸 사람(`invitedById`)으로 다시 유추하지 않는다.
 */
const ME = 'synthetic-user-01';
const BASIC_PROGRAM = 'program-basic-study';
const CAPSTONE_PROGRAM = 'program-capstone';
const INVITED_TEAM_ID = 'synthetic-team-capstone-2';
const RECEIVED_INVITATION_ID = 'synthetic-invitation-received-01';

function call(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  search = '',
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
  });
}

function callWithBody(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  body: unknown,
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(),
    body,
  });
}

function jsonBody(
  plan: ReturnType<typeof resolveLocalReviewResponse>,
  status = 200,
): unknown {
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body;
}

/** 학생 페르소나의 본문 없는 조작 — 취소·수락·거절이 모두 이 모양이다. */
function post(path: string) {
  return call('student', 'POST', path);
}

function member(
  userId: string,
  nickname: string,
  isLeader: boolean,
): TeamMember {
  return { userId, nickname, name: null, isLeader };
}

/**
 * 세션에 직접 심는 팀. 팀장 승계·탈퇴는 학생 동선 규칙이 만들지만, 초대 규칙이
 * 그 결과를 어떻게 읽는지는 여기서 팀 상태를 직접 놓아야 확인할 수 있다.
 */
function storedTeam(overrides: Partial<ProgramTeam> = {}): ProgramTeam {
  const merged: ProgramTeam = {
    id: `synthetic-team-${BASIC_PROGRAM}`,
    name: '합성 기초 오픈소스팀',
    memberCount: 1,
    minMembers: 1,
    maxMembers: 4,
    hasApplication: true,
    canInvite: true,
    canRemoveMembers: false,
    canLeave: false,
    isLeader: true,
    members: [member(ME, 'synthetic-contributor-01', true)],
    ...overrides,
  };
  return { ...merged, memberCount: merged.members.length };
}

function receivedInvitation(
  overrides: Partial<ReceivedTeamInvitation> = {},
): ReceivedTeamInvitation {
  return {
    id: 'synthetic-invitation-received-02',
    teamId: 'synthetic-team-capstone-3',
    programId: CAPSTONE_PROGRAM,
    invitedById: 'synthetic-user-capstone-3-1',
    status: 'PENDING',
    invitedAt: '2026-07-30T03:00:00.000Z',
    respondedAt: null,
    teamName: '합성 캡스톤 3팀',
    programName: '합성 캡스톤 프로그램',
    invitedByDisplayName: 'synthetic-leader-03',
    memberCount: 1,
    teamMaxSize: 4,
    ...overrides,
  };
}

function seedReceivedInvitation(invitation: ReceivedTeamInvitation): void {
  localReviewSessionState().receivedInvitationOverrides[invitation.id] =
    invitation;
}

/** 신청까지 낸 팀장 상태를 실제 학생 동선 경로로 만든다. */
function createTeamWithApplication(): string {
  const created = jsonBody(
    callWithBody('student', 'POST', `programs/${BASIC_PROGRAM}/teams`, {
      name: '합성 기초 오픈소스팀',
    }),
  ) as { readonly id: string };
  jsonBody(call('student', 'POST', `programs/${BASIC_PROGRAM}/applications`));
  return created.id;
}

function myTeam(programId: string): ProgramTeam {
  return jsonBody(
    call('student', 'GET', `programs/${programId}/teams/me`),
  ) as ProgramTeam;
}

function sentInvitations(teamId: string): readonly SentTeamInvitation[] {
  return jsonBody(
    call('student', 'GET', `team-invitations/teams/${teamId}/sent`),
  ) as readonly SentTeamInvitation[];
}

function receivedInvitations(): readonly ReceivedTeamInvitation[] {
  return jsonBody(
    call('student', 'GET', 'team-invitations/received'),
  ) as readonly ReceivedTeamInvitation[];
}

describe('team invitation fixture continuity', () => {
  it('신청을 낸 팀의 팀장은 계속 검색·초대·취소할 수 있다', () => {
    resetLocalReviewFixtureState();
    const teamId = createTeamWithApplication();
    // 신청을 냈다는 사실은 남지만 초대 능력은 그대로다 — 예전 `locked` 게이트 없음.
    expect(myTeam(BASIC_PROGRAM)).toMatchObject({
      hasApplication: true,
      isLeader: true,
      canInvite: true,
    });

    const candidates = jsonBody(
      call(
        'student',
        'GET',
        `team-invitations/teams/${teamId}/search`,
        'query=synthetic',
      ),
    ) as readonly InvitationCandidate[];
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'synthetic-user-04',
      'synthetic-user-05',
    ]);
    // 빈 검색어는 후보 명단을 통째로 흘리지 않는다.
    expect(
      jsonBody(
        call(
          'student',
          'GET',
          `team-invitations/teams/${teamId}/search`,
          'query=%20',
        ),
      ),
    ).toEqual([]);

    const created = jsonBody(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ) as SentTeamInvitation;
    expect(created).toMatchObject({
      teamId,
      programId: BASIC_PROGRAM,
      invitedById: ME,
      status: 'PENDING',
      respondedAt: null,
    });
    // 보낸 초대의 대상 정보는 최소 표시 필드뿐이다(학번·이메일·연락처 없음).
    expect(Object.keys(created.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
    expect(created.invitee).toEqual({
      id: 'synthetic-user-04',
      nickname: 'synthetic-contributor-04',
      name: '합성 지원자 4',
      avatarUrl: null,
    });

    // 조회를 반복해도 같은 상태가 남는다.
    expect(sentInvitations(teamId)).toEqual([
      expect.objectContaining({ id: created.id, status: 'PENDING' }),
    ]);
    expect(sentInvitations(teamId)).toEqual([
      expect.objectContaining({ id: created.id, status: 'PENDING' }),
    ]);

    // 같은 대상에게 두 번은 보내지 못한다.
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_008' } });
    // 자기 자신은 초대 대상이 아니다 — 실제 서버와 같은 422다.
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: ME },
      ),
    ).toMatchObject({ kind: 'json', status: 422, body: { code: 'TIV_005' } });
    // 모르는 사용자는 초대하지 못한다.
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-unknown' },
      ),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TIV_006' } });

    jsonBody(post(`team-invitations/${created.id}/cancel`));
    expect(sentInvitations(teamId)).toEqual([
      expect.objectContaining({
        id: created.id,
        invitee: created.invitee,
        status: 'DECLINED',
        respondedAt: expect.any(String),
      }),
    ]);
    // 이미 종결된 초대는 다시 취소되지 않는다.
    expect(post(`team-invitations/${created.id}/cancel`)).toMatchObject({
      kind: 'json',
      status: 409,
      body: { code: 'TIV_011' },
    });
  });

  it('이미 이 프로그램 팀에 있는 사람은 검색·초대 어디서도 나오지 않는다', () => {
    resetLocalReviewFixtureState();
    const teamId = createTeamWithApplication();
    rememberProgramTeam(
      BASIC_PROGRAM,
      storedTeam({
        id: teamId,
        canRemoveMembers: true,
        canLeave: true,
        members: [
          member(ME, 'synthetic-contributor-01', true),
          member('synthetic-user-04', 'synthetic-contributor-04', false),
        ],
      }),
    );

    expect(
      (
        jsonBody(
          call(
            'student',
            'GET',
            `team-invitations/teams/${teamId}/search`,
            'query=synthetic',
          ),
        ) as readonly InvitationCandidate[]
      ).map((candidate) => candidate.id),
    ).toEqual(['synthetic-user-05']);
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_007' } });

    // 정원이 찬 팀은 더 초대할 수 없다.
    rememberProgramTeam(
      BASIC_PROGRAM,
      storedTeam({
        id: teamId,
        maxMembers: 2,
        canRemoveMembers: true,
        canLeave: true,
        members: [
          member(ME, 'synthetic-contributor-01', true),
          member('synthetic-user-05', 'synthetic-contributor-05', false),
        ],
      }),
    );
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_009' } });
  });

  it('수락은 나를 일반 구성원으로 합류시키고 팀장을 바꾸지 않는다', () => {
    resetLocalReviewFixtureState();
    // 이 프로그램에는 아직 내 팀이 없다.
    rememberProgramTeam(CAPSTONE_PROGRAM, null);
    expect(receivedInvitations()).toEqual([
      expect.objectContaining({
        id: RECEIVED_INVITATION_ID,
        status: 'PENDING',
        teamId: INVITED_TEAM_ID,
      }),
    ]);

    expect(
      jsonBody(post(`team-invitations/${RECEIVED_INVITATION_ID}/accept`)),
    ).toEqual({ teamId: INVITED_TEAM_ID, programId: CAPSTONE_PROGRAM });

    const joined = myTeam(CAPSTONE_PROGRAM);
    expect(joined).toMatchObject({
      id: INVITED_TEAM_ID,
      memberCount: 2,
      // 초대를 수락했다고 신청 이력이 생기지는 않는다.
      hasApplication: false,
      isLeader: false,
      canInvite: false,
      canRemoveMembers: false,
      canLeave: true,
    });
    expect(joined.members.find((entry) => entry.userId === ME)).toMatchObject({
      isLeader: false,
    });
    expect(
      joined.members.find(
        (entry) => entry.userId === 'synthetic-user-capstone-2-1',
      ),
    ).toMatchObject({ isLeader: true, nickname: 'synthetic-leader-02' });

    // 헤더 폴링이 다시 읽어도 수락 상태가 남는다.
    expect(receivedInvitations()).toEqual([
      expect.objectContaining({
        id: RECEIVED_INVITATION_ID,
        status: 'ACCEPTED',
        respondedAt: expect.any(String),
      }),
    ]);
    // 종결된 초대에는 수락·거절 모두 같은 코드로 답한다.
    expect(
      post(`team-invitations/${RECEIVED_INVITATION_ID}/accept`),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_011' } });
    expect(
      post(`team-invitations/${RECEIVED_INVITATION_ID}/decline`),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_011' } });
    // 모르는 초대에 성공을 지어내지 않는다.
    expect(post('team-invitations/synthetic-unknown/accept')).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'TIV_010' },
    });
  });

  it('수락하면 같은 프로그램의 남은 대기 초대가 함께 종결된다', () => {
    resetLocalReviewFixtureState();
    rememberProgramTeam(CAPSTONE_PROGRAM, null);
    const sibling = receivedInvitation();
    const otherProgram = receivedInvitation({
      id: 'synthetic-invitation-received-03',
      teamId: 'synthetic-team-contest-1',
      programId: 'program-oss-contest',
      programName: '합성 OSS 경진대회',
    });
    seedReceivedInvitation(sibling);
    seedReceivedInvitation(otherProgram);

    jsonBody(post(`team-invitations/${RECEIVED_INVITATION_ID}/accept`));

    const invitations = receivedInvitations();
    const byId = new Map(
      invitations.map((invitation) => [invitation.id, invitation]),
    );
    expect(byId.get(RECEIVED_INVITATION_ID)?.status).toBe('ACCEPTED');
    expect(byId.get(sibling.id)).toMatchObject({
      status: 'DECLINED',
      respondedAt: expect.any(String),
    });
    // 다른 프로그램의 초대는 건드리지 않는다.
    expect(byId.get(otherProgram.id)?.status).toBe('PENDING');

    // 종결된 같은 프로그램 초대는 다시 수락되지 않는다.
    expect(post(`team-invitations/${sibling.id}/accept`)).toMatchObject({
      kind: 'json',
      status: 409,
      body: { code: 'TIV_011' },
    });
    // 합류 뒤 새로 온 같은 프로그램 초대는 소속 충돌로 끊는다.
    seedReceivedInvitation(
      receivedInvitation({ id: 'synthetic-invitation-received-04' }),
    );
    expect(
      post('team-invitations/synthetic-invitation-received-04/accept'),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TIV_007' } });
  });

  it('취소 권한은 보낸 사람이 아니라 지금의 팀장을 따른다', () => {
    resetLocalReviewFixtureState();
    const teamId = createTeamWithApplication();
    const created = jsonBody(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ) as SentTeamInvitation;
    expect(created.invitedById).toBe(ME);

    // 팀장이 다른 사람으로 바뀌면, 초대를 보냈던 사람도 더는 취소할 수 없다.
    const asMember = storedTeam({
      id: teamId,
      isLeader: false,
      canInvite: false,
      canRemoveMembers: false,
      canLeave: true,
      members: [
        member('synthetic-user-02', 'synthetic-contributor-02', true),
        member(ME, 'synthetic-contributor-01', false),
      ],
    });
    rememberProgramTeam(BASIC_PROGRAM, asMember);
    expect(post(`team-invitations/${created.id}/cancel`)).toMatchObject({
      kind: 'json',
      status: 403,
      body: { code: 'TIV_003' },
    });
    // 팀원은 목록은 볼 수 있고, 초대는 그대로 대기 중이다.
    expect(sentInvitations(teamId)).toEqual([
      expect.objectContaining({ id: created.id, status: 'PENDING' }),
    ]);

    // 팀을 떠난 뒤에는 자기가 보낸 초대도 정리하지 못하고 목록도 볼 수 없다.
    rememberProgramTeam(BASIC_PROGRAM, null);
    expect(post(`team-invitations/${created.id}/cancel`)).toMatchObject({
      kind: 'json',
      status: 403,
      body: { code: 'TIV_003' },
    });
    expect(
      call('student', 'GET', `team-invitations/teams/${teamId}/sent`),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'TIV_004' } });

    // 팀장을 승계받으면 전 팀장이 남긴 초대를 정리할 수 있다.
    rememberProgramTeam(
      BASIC_PROGRAM,
      storedTeam({
        id: teamId,
        canRemoveMembers: true,
        canLeave: true,
        members: [
          member(ME, 'synthetic-contributor-01', true),
          member('synthetic-user-02', 'synthetic-contributor-02', false),
        ],
      }),
    );
    jsonBody(post(`team-invitations/${created.id}/cancel`));
    expect(sentInvitations(teamId)).toEqual([
      expect.objectContaining({ id: created.id, status: 'DECLINED' }),
    ]);
  });

  it('팀장이 아니거나 모르는 팀의 초대 경로를 실제 코드로 끊는다', () => {
    resetLocalReviewFixtureState();
    const teamId = createTeamWithApplication();
    rememberProgramTeam(
      BASIC_PROGRAM,
      storedTeam({
        id: teamId,
        isLeader: false,
        canInvite: false,
        canLeave: true,
        members: [
          member('synthetic-user-02', 'synthetic-contributor-02', true),
          member(ME, 'synthetic-contributor-01', false),
        ],
      }),
    );
    // 팀원은 검색·초대를 하지 못한다.
    expect(
      call(
        'student',
        'GET',
        `team-invitations/teams/${teamId}/search`,
        'query=synthetic',
      ),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'TIV_003' } });
    expect(
      callWithBody(
        'student',
        'POST',
        `team-invitations/teams/${teamId}/invitations`,
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'TIV_003' } });

    // 존재를 모르는 팀은 404다.
    expect(
      call('student', 'GET', 'team-invitations/teams/missing-team/sent'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TIV_002' } });
    expect(
      callWithBody(
        'student',
        'POST',
        'team-invitations/teams/missing-team/invitations',
        { inviteeUserId: 'synthetic-user-04' },
      ),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TIV_002' } });
    expect(post('team-invitations/synthetic-unknown/cancel')).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'TIV_010' },
    });

    // 로그인하지 않은 검토 페르소나는 실제 SessionGuard 코드로 끊는다.
    expect(call('anonymous', 'GET', 'team-invitations/received')).toMatchObject(
      { kind: 'json', status: 401, body: { code: 'AUT_003' } },
    );
  });

  it('기준 팀의 보낸 초대는 초기화 뒤 원래 상태로 돌아온다', () => {
    resetLocalReviewFixtureState();
    const baseline = sentInvitations(STUDENT_TEAM_ID);
    expect(baseline).toEqual([
      expect.objectContaining({
        id: 'synthetic-invitation-sent-01',
        invitee: expect.objectContaining({ id: 'synthetic-user-04' }),
        status: 'PENDING',
      }),
    ]);

    jsonBody(post('team-invitations/synthetic-invitation-sent-01/cancel'));
    expect(sentInvitations(STUDENT_TEAM_ID)).toEqual([
      expect.objectContaining({
        id: 'synthetic-invitation-sent-01',
        status: 'DECLINED',
      }),
    ]);

    resetLocalReviewFixtureState();
    expect(sentInvitations(STUDENT_TEAM_ID)).toEqual(baseline);
  });
});
