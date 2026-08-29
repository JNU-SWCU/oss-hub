import type {
  InvitationCandidate,
  TeamInvitation,
} from '@/features/programs/team-invitation-api';

/**
 * 팀 초대 픽스처. 로컬 검토 학생 페르소나는 항상 캡스톤 팀장
 * (student-program-fixtures.ts의 `synthetic-user-01`, 팀 `synthetic-team-capstone`)이다 —
 * "받은 초대"는 다른 팀(program-overview-fixtures.ts가 절차적으로 만든
 * `synthetic-team-capstone-2`)에서 온 것으로, "보낸 초대"는 내 팀이 보낸 것으로 둔다.
 */
export const STUDENT_TEAM_ID = 'synthetic-team-capstone';

const OTHER_TEAM_ID = 'synthetic-team-capstone-2';
const OTHER_TEAM_LEADER_ID = 'synthetic-user-capstone-2-1';

export const RECEIVED_INVITATIONS: readonly TeamInvitation[] = [
  {
    id: 'synthetic-invitation-received-01',
    teamId: OTHER_TEAM_ID,
    programId: 'program-capstone',
    invitedById: OTHER_TEAM_LEADER_ID,
    status: 'PENDING',
    invitedAt: '2026-07-30T02:00:00.000Z',
    respondedAt: null,
  },
];

const SENT_INVITATIONS_BY_TEAM: Readonly<
  Record<string, readonly TeamInvitation[]>
> = {
  [STUDENT_TEAM_ID]: [
    {
      id: 'synthetic-invitation-sent-01',
      teamId: STUDENT_TEAM_ID,
      programId: 'program-capstone',
      invitedById: 'synthetic-user-01',
      status: 'PENDING',
      invitedAt: '2026-07-29T05:00:00.000Z',
      respondedAt: null,
    },
  ],
};

export function sentInvitationsFor(teamId: string): readonly TeamInvitation[] {
  return SENT_INVITATIONS_BY_TEAM[teamId] ?? [];
}

/** 검색 후보 — 학번·이메일·연락처는 실제 DTO에도 없다(PII 경계). */
const SEARCH_CANDIDATES: readonly InvitationCandidate[] = [
  {
    id: 'synthetic-user-04',
    nickname: 'synthetic-contributor-04',
    name: '합성 지원자 4',
    avatarUrl: null,
  },
  {
    id: 'synthetic-user-05',
    nickname: 'synthetic-contributor-05',
    name: null,
    avatarUrl: null,
  },
];

export function searchCandidatesFor(
  query: string,
): readonly InvitationCandidate[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return SEARCH_CANDIDATES;
  return SEARCH_CANDIDATES.filter(
    (candidate) =>
      candidate.nickname.toLowerCase().includes(normalized) ||
      (candidate.name?.toLowerCase().includes(normalized) ?? false),
  );
}

/** cancel/decline/accept는 저장되지 않으므로 요청받은 id를 그대로 돌려주는 고정 초대를 준다. */
export function invitationFor(invitationId: string): TeamInvitation {
  return {
    id: invitationId,
    teamId: STUDENT_TEAM_ID,
    programId: 'program-capstone',
    invitedById: 'synthetic-user-01',
    status: 'PENDING',
    invitedAt: '2026-07-29T05:00:00.000Z',
    respondedAt: null,
  };
}
