import type { ProgramTeam, TeamMember } from '@/features/programs/api';
import type {
  InvitationCandidate,
  ReceivedTeamInvitation,
  SentTeamInvitation,
  TeamInvitationStatus,
} from '@/features/programs/team-invitation-api';
import { apiPath } from '@/lib/api-client';
import {
  accepted,
  bodyString,
  json,
  localReviewSessionState,
  matchGet,
  matchPath,
  problem,
  unauthenticated,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';
import {
  currentSyntheticUserId,
  findOwnedTeamById,
  rememberProgramTeam,
  resolveProgramTeam,
  teamWithCapabilities,
} from './student-handlers';
import {
  RECEIVED_INVITATIONS,
  searchCandidatesFor,
  sentInvitationsFor,
  STUDENT_TEAM_ID,
} from './team-invitation-fixtures';

/**
 * 팀 초대 동선의 로컬 검토 응답.
 *
 * 상태를 실제로 옮긴다 — 초대를 만들고 취소하고 수락한 결과가 다음 조회와 헤더
 * 폴링에 그대로 남아야 검토자가 「우리 팀」·신청 화면·헤더 세 자리를 한 흐름으로
 * 걸어 볼 수 있다.
 *
 * 권한 판정의 정본은 **서버가 계산해 준 능력 플래그**다(`ProgramTeam.canInvite`).
 * 화면도 픽스처도 팀장 여부·신청 이력으로 규칙을 다시 유추하지 않는다(ADR-007).
 * 신청 제출 여부는 초대·검색·수락을 막지 않는다 — 신청 창구는 초기 접수의 문일
 * 뿐이라 backend 도 더는 그 게이트를 두지 않는다(`team-invitations.service.ts`).
 * 예전의 `locked`·`TIV_014` 갈래는 실제 서버가 만들 수 없는 응답이라 없앴다.
 */
function matchMethod(
  context: LocalReviewContext,
  method: string,
  pattern: string,
): Record<string, string> | null {
  return context.method === method ? matchPath(pattern, context.path) : null;
}

const SYNTHETIC_INVITED_AT = '2026-08-01T00:00:00.000Z';
const SYNTHETIC_RESPONDED_AT = '2026-08-01T00:05:00.000Z';

/** 수락으로 합류한 나. 팀장은 승계되지 않는다 — 합류는 언제나 일반 구성원이다. */
const JOINED_MEMBER_LABEL = {
  nickname: 'synthetic-contributor-01',
  name: '합성 설정 사용자',
} as const;

function requireStudent(
  context: LocalReviewContext,
): ReturnType<typeof unauthenticated> | ReturnType<typeof problem> | null {
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return null;
}

function sentBucket(teamId: string): Record<string, SentTeamInvitation | null> {
  const { sentInvitationsByTeam } = localReviewSessionState();
  const existing = sentInvitationsByTeam[teamId];
  if (existing !== undefined) return existing;
  const created: Record<string, SentTeamInvitation | null> = {};
  sentInvitationsByTeam[teamId] = created;
  return created;
}

function resolveSentInvitations(teamId: string): SentTeamInvitation[] {
  const bucket = sentBucket(teamId);
  const items: SentTeamInvitation[] = [];
  const seen = new Set<string>();
  for (const [id, invitation] of Object.entries(bucket)) {
    seen.add(id);
    if (invitation !== null) items.push(invitation);
  }
  for (const invitation of sentInvitationsFor(teamId)) {
    if (seen.has(invitation.id)) continue;
    items.push(invitation);
  }
  return items;
}

function rememberSentInvitation(
  teamId: string,
  invitation: SentTeamInvitation | null,
  invitationId: string,
): void {
  sentBucket(teamId)[invitationId] = invitation;
}

/**
 * 이 검토 세션이 아는 팀 id. 조회만으로 만들어진 **빈** 보낸 초대 칸은 세지 않는다
 * — 없는 팀을 한 번 조회했다는 이유로 그 팀이 존재하게 되면 404가 403으로 바뀐다.
 */
function knownSentTeamIds(): Set<string> {
  const { sentInvitationsByTeam, programTeams } = localReviewSessionState();
  const teamIds = new Set(
    Object.entries(sentInvitationsByTeam)
      .filter(([, bucket]) => Object.keys(bucket).length > 0)
      .map(([teamId]) => teamId),
  );
  for (const programId of Object.keys(programTeams)) {
    const team = resolveProgramTeam(programId);
    if (team !== null) teamIds.add(team.id);
  }
  return teamIds;
}

function findSentInvitation(
  invitationId: string,
): SentTeamInvitation | null | undefined {
  const { sentInvitationsByTeam } = localReviewSessionState();
  for (const bucket of Object.values(sentInvitationsByTeam)) {
    if (invitationId in bucket) return bucket[invitationId];
  }
  // 기준 팀의 고정 초대는 세션에 아무것도 남기지 않아도 항상 찾을 수 있어야 한다 —
  // 검토를 막 시작한 사람이 처음 누르는 취소가 그 초대다.
  for (const teamId of new Set([STUDENT_TEAM_ID, ...knownSentTeamIds()])) {
    const found = sentInvitationsFor(teamId).find(
      (invitation) => invitation.id === invitationId,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function resolveReceivedInvitations(): ReceivedTeamInvitation[] {
  const { receivedInvitationOverrides } = localReviewSessionState();
  const items: ReceivedTeamInvitation[] = [];
  const seen = new Set<string>();
  for (const [id, invitation] of Object.entries(receivedInvitationOverrides)) {
    seen.add(id);
    if (invitation !== null) items.push(invitation);
  }
  for (const invitation of RECEIVED_INVITATIONS) {
    if (seen.has(invitation.id)) continue;
    items.push(invitation);
  }
  return items;
}

function rememberReceivedInvitation(
  invitationId: string,
  invitation: ReceivedTeamInvitation | null,
): void {
  localReviewSessionState().receivedInvitationOverrides[invitationId] =
    invitation;
}

function findReceivedInvitation(
  invitationId: string,
): ReceivedTeamInvitation | null | undefined {
  const { receivedInvitationOverrides } = localReviewSessionState();
  if (invitationId in receivedInvitationOverrides) {
    return receivedInvitationOverrides[invitationId];
  }
  return RECEIVED_INVITATIONS.find(
    (invitation) => invitation.id === invitationId,
  );
}

interface OwnedTeam {
  readonly programId: string;
  readonly team: ProgramTeam;
}

/**
 * 이 팀을 지금 어떻게 볼 수 있는가.
 *
 * `owned`가 있으면 내가 속한 팀이라 능력 플래그를 그대로 쓸 수 있다. 없는데
 * `known`이면 팀은 존재하지만 내가 그 팀 사람이 아니다 — 그때 404를 주면 화면이
 * "팀이 사라졌다"로 갈려, 탈퇴 뒤 남은 초대를 정리하려다 막히는 실제 갈래가
 * 로컬 검토에서만 다르게 보인다.
 */
function teamAccess(teamId: string): {
  readonly owned: OwnedTeam | null;
  readonly known: boolean;
} {
  const owned = findOwnedTeamById(teamId);
  const known =
    owned !== null ||
    sentInvitationsFor(teamId).length > 0 ||
    knownSentTeamIds().has(teamId);
  return { owned, known };
}

function teamNotFound(path: string) {
  return problem(404, 'TIV_002', apiPath(path), '팀을 찾을 수 없습니다.');
}

function notTeamLeader(path: string) {
  return problem(
    403,
    'TIV_003',
    apiPath(path),
    '팀장만 초대를 관리할 수 있습니다.',
  );
}

function userIdsInProgram(programId: string): Set<string> {
  const team = resolveProgramTeam(programId);
  return new Set(team?.members.map((member) => member.userId) ?? []);
}

/** 초대 대상 후보 — 나와 이 프로그램 팀 소속자는 검색·초대 어디서도 제외한다. */
function excludedCandidateIds(programId: string): Set<string> {
  const excluded = userIdsInProgram(programId);
  excluded.add(currentSyntheticUserId());
  return excluded;
}

function candidateById(inviteeUserId: string): InvitationCandidate | undefined {
  return searchCandidatesFor('').find(
    (candidate) => candidate.id === inviteeUserId,
  );
}

const receivedHandler: LocalReviewHandler = (context) => {
  if (matchGet(context, 'team-invitations/received') === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  return json(
    200,
    context.role === 'STUDENT' ? resolveReceivedInvitations() : [],
  );
};

const sentHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'team-invitations/teams/:teamId/sent');
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  const teamId = params.teamId ?? '';
  const { owned, known } = teamAccess(teamId);
  if (owned === null) {
    return known
      ? problem(
          403,
          'TIV_004',
          apiPath(context.path),
          '팀 구성원만 조회할 수 있습니다.',
        )
      : teamNotFound(context.path);
  }
  if (
    !owned.team.members.some(
      (member) => member.userId === currentSyntheticUserId(),
    )
  ) {
    return problem(
      403,
      'TIV_004',
      apiPath(context.path),
      '팀 구성원만 조회할 수 있습니다.',
    );
  }
  return json(200, resolveSentInvitations(teamId));
};

const searchHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'team-invitations/teams/:teamId/search');
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  const teamId = params.teamId ?? '';
  const { owned, known } = teamAccess(teamId);
  if (owned === null) {
    return known ? notTeamLeader(context.path) : teamNotFound(context.path);
  }
  // 검색도 팀장 권한이다 — 팀장이 아닌 사람에게 후보의 존재를 알리지 않는다.
  if (!owned.team.canInvite) return notTeamLeader(context.path);
  // 빈 검색어는 후보를 통째로 흘리지 않는다(backend `searchCandidates`).
  const query = (context.searchParams.get('query') ?? '').trim();
  if (query === '') return json(200, []);
  const excluded = excludedCandidateIds(owned.programId);
  return json(
    200,
    searchCandidatesFor(query).filter(
      (candidate) => !excluded.has(candidate.id),
    ),
  );
};

const createInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/teams/:teamId/invitations',
  );
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  if (context.role !== 'STUDENT') return notTeamLeader(context.path);
  const teamId = params.teamId ?? '';
  const { owned, known } = teamAccess(teamId);
  if (owned === null) {
    return known ? notTeamLeader(context.path) : teamNotFound(context.path);
  }
  // 신청을 낸 팀이라도 팀장은 계속 초대할 수 있다 — 잠그는 것은 능력 플래그뿐이다.
  if (!owned.team.canInvite) return notTeamLeader(context.path);

  const inviteeUserId = bodyString(context, 'inviteeUserId')?.trim() ?? '';
  if (inviteeUserId === '') {
    return problem(
      400,
      'SYS_003',
      apiPath(context.path),
      'inviteeUserId should not be empty',
    );
  }
  if (inviteeUserId === currentSyntheticUserId()) {
    return problem(
      422,
      'TIV_005',
      apiPath(context.path),
      '자기 자신을 초대할 수 없습니다.',
    );
  }
  // 이미 이 프로그램의 팀에 있는 사람은 후보 명단에 없어도 존재하는 사용자다 —
  // "사용자 없음"으로 답하면 화면이 엉뚜한 안내를 그린다.
  if (userIdsInProgram(owned.programId).has(inviteeUserId)) {
    return problem(
      409,
      'TIV_007',
      apiPath(context.path),
      '이미 이 프로그램의 다른 팀에 소속된 사용자입니다.',
    );
  }
  const invitee = candidateById(inviteeUserId);
  if (invitee === undefined) {
    return problem(
      404,
      'TIV_006',
      apiPath(context.path),
      '초대 대상 사용자를 찾을 수 없습니다.',
    );
  }
  if (owned.team.members.length >= owned.team.maxMembers) {
    return problem(
      409,
      'TIV_009',
      apiPath(context.path),
      '팀 최대 인원을 초과할 수 없습니다.',
    );
  }
  const alreadyPending = resolveSentInvitations(teamId).some(
    (invitation) =>
      invitation.invitee.id === invitee.id && invitation.status === 'PENDING',
  );
  if (alreadyPending) {
    return problem(
      409,
      'TIV_008',
      apiPath(context.path),
      '이미 대기 중인 초대가 있습니다.',
    );
  }
  const invitation: SentTeamInvitation = {
    id: `synthetic-invitation-${teamId}-${invitee.id}`,
    teamId,
    programId: owned.programId,
    // 보낸 사람은 기록으로 남을 뿐 권한의 기준이 아니다 — 취소는 그때의 팀장이 한다.
    invitedById: currentSyntheticUserId(),
    status: 'PENDING',
    invitedAt: SYNTHETIC_INVITED_AT,
    respondedAt: null,
    // 보낸 초대에만 실리는 최소 표시 정보. 학번·이메일·연락처는 담지 않는다.
    invitee: {
      id: invitee.id,
      nickname: invitee.nickname,
      name: invitee.name,
      avatarUrl: invitee.avatarUrl,
    },
  };
  rememberSentInvitation(teamId, invitation, invitation.id);
  return accepted(invitation);
};

function closeInvitationStatus(
  invitationId: string,
  status: Extract<TeamInvitationStatus, 'DECLINED' | 'ACCEPTED'>,
): SentTeamInvitation | ReceivedTeamInvitation | null {
  const sent = findSentInvitation(invitationId);
  if (sent !== undefined && sent !== null) {
    const next: SentTeamInvitation = {
      ...sent,
      status,
      respondedAt: SYNTHETIC_RESPONDED_AT,
    };
    rememberSentInvitation(sent.teamId, next, invitationId);
    return next;
  }
  const received = findReceivedInvitation(invitationId);
  if (received !== undefined && received !== null) {
    const next: ReceivedTeamInvitation = {
      ...received,
      status,
      respondedAt: SYNTHETIC_RESPONDED_AT,
    };
    rememberReceivedInvitation(invitationId, next);
    return next;
  }
  return null;
}

/**
 * 대기 중인 초대 취소 — 권한은 **지금의 팀장**이다. 초대를 보낸 사람
 * (`invitedById`)이 아니다. 그래야 승계받은 팀장이 전 팀장이 남긴 초대를 정리할 수
 * 있고, 이미 떠난 사람은 자기가 보낸 초대라도 정리할 수 없다.
 */
const cancelInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/cancel',
  );
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  const invitationId = params.invitationId ?? '';
  const invitation = findSentInvitation(invitationId);
  if (invitation === undefined || invitation === null) {
    return problem(
      404,
      'TIV_010',
      apiPath(context.path),
      '초대를 찾을 수 없습니다.',
    );
  }
  const { owned } = teamAccess(invitation.teamId);
  if (owned === null || !owned.team.canInvite) {
    return notTeamLeader(context.path);
  }
  if (invitation.status !== 'PENDING') {
    return problem(
      409,
      'TIV_011',
      apiPath(context.path),
      '이미 처리된 초대입니다.',
    );
  }
  closeInvitationStatus(invitationId, 'DECLINED');
  return accepted();
};

const declineInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/decline',
  );
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  const invitationId = params.invitationId ?? '';
  const invitation = findReceivedInvitation(invitationId);
  if (invitation === undefined || invitation === null) {
    return problem(
      404,
      'TIV_010',
      apiPath(context.path),
      '초대를 찾을 수 없습니다.',
    );
  }
  if (invitation.status !== 'PENDING') {
    return problem(
      409,
      'TIV_011',
      apiPath(context.path),
      '이미 처리된 초대입니다.',
    );
  }
  closeInvitationStatus(invitationId, 'DECLINED');
  return accepted();
};

function invitationLeaderMember(
  invitation: ReceivedTeamInvitation,
): TeamMember {
  return {
    userId: invitation.invitedById,
    nickname: invitation.invitedByDisplayName,
    name: null,
    isLeader: true,
  };
}

function joinedMember(): TeamMember {
  return {
    userId: currentSyntheticUserId(),
    nickname: JOINED_MEMBER_LABEL.nickname,
    name: JOINED_MEMBER_LABEL.name,
    // 합류는 일반 구성원으로만 일어난다 — 수락이 팀장을 바꾸지 않는다.
    isLeader: false,
  };
}

/**
 * 같은 프로그램에 남은 내 대기 초대를 함께 종결한다. 합류한 뒤에는 어차피 다른 팀
 * 초대를 수락할 수 없는데, 남겨 두면 헤더와 받은 초대 목록에서 계속 눌러 볼 수
 * 있는 초대로 보인다(backend 수락 트랜잭션과 같은 정리).
 */
function terminalizeSameProgramInvitations(
  programId: string,
  acceptedInvitationId: string,
): void {
  for (const invitation of resolveReceivedInvitations()) {
    if (invitation.id === acceptedInvitationId) continue;
    if (invitation.programId !== programId) continue;
    if (invitation.status !== 'PENDING') continue;
    rememberReceivedInvitation(invitation.id, {
      ...invitation,
      status: 'DECLINED',
      respondedAt: SYNTHETIC_RESPONDED_AT,
    });
  }
}

const acceptInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/accept',
  );
  if (params === null) return null;
  const auth = requireStudent(context);
  if (auth !== null) return auth;
  const invitationId = params.invitationId ?? '';
  const invitation = findReceivedInvitation(invitationId);
  // 모르는 초대에 성공을 지어내지 않는다 — 실제 서버는 404로 끊는다.
  if (invitation === undefined || invitation === null) {
    return problem(
      404,
      'TIV_010',
      apiPath(context.path),
      '초대를 찾을 수 없습니다.',
    );
  }
  if (invitation.status !== 'PENDING') {
    return problem(
      409,
      'TIV_011',
      apiPath(context.path),
      '이미 처리된 초대입니다.',
    );
  }
  // 프로그램당 팀은 하나다(`@@unique([programId,userId])`).
  if (resolveProgramTeam(invitation.programId) !== null) {
    return problem(
      409,
      'TIV_007',
      apiPath(context.path),
      '이미 이 프로그램의 다른 팀에 소속된 사용자입니다.',
    );
  }
  if (invitation.memberCount >= invitation.teamMaxSize) {
    return problem(
      409,
      'TIV_009',
      apiPath(context.path),
      '팀 최대 인원을 초과할 수 없습니다.',
    );
  }
  // 신청 이력은 합류로 바뀌지 않는다. 팀의 실제 기록으로 권한을 투영한다.
  const joined = teamWithCapabilities(invitation.programId, {
    id: invitation.teamId,
    name: invitation.teamName,
    minMembers: null,
    maxMembers: invitation.teamMaxSize,
    isLeader: false,
    members: [invitationLeaderMember(invitation), joinedMember()],
  });
  rememberProgramTeam(invitation.programId, joined);
  closeInvitationStatus(invitationId, 'ACCEPTED');
  terminalizeSameProgramInvitations(invitation.programId, invitationId);
  return accepted({
    teamId: invitation.teamId,
    programId: invitation.programId,
  });
};

export const TEAM_INVITATION_HANDLERS: readonly LocalReviewHandler[] = [
  receivedHandler,
  sentHandler,
  searchHandler,
  createInvitationHandler,
  cancelInvitationHandler,
  declineInvitationHandler,
  acceptInvitationHandler,
];
