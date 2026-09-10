import type {
  InvitationCandidate,
  ReceivedTeamInvitation,
  SentTeamInvitation,
  TeamInvitation,
} from '@/features/programs/team-invitation-api';

/** 합성 화면 캡처용 고정 응답. 실제 초대 상태 전이는 backend integration에서 검증한다. */
export const STUDENT_TEAM_ID = 'synthetic-team-capstone';
const OTHER_TEAM_ID = 'synthetic-team-capstone-2';

export const RECEIVED_INVITATIONS: readonly ReceivedTeamInvitation[] = [
  {
    id: 'synthetic-invitation-received-01',
    teamId: OTHER_TEAM_ID,
    programId: 'program-capstone',
    invitedById: 'synthetic-user-capstone-2-1',
    status: 'PENDING',
    invitedAt: '2026-07-30T02:00:00.000Z',
    respondedAt: null,
    teamName: '합성 캡스톤 2팀',
    programName: '합성 캡스톤 프로그램',
    invitedByDisplayName: 'synthetic-leader-02',
    memberCount: 2,
    teamMaxSize: 4,
  },
];

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

export function sentInvitationsFor(
  teamId: string,
): readonly SentTeamInvitation[] {
  if (teamId !== STUDENT_TEAM_ID) return [];
  return [
    {
      id: 'synthetic-invitation-sent-01',
      teamId: STUDENT_TEAM_ID,
      programId: 'program-capstone',
      invitedById: 'synthetic-user-01',
      status: 'PENDING',
      invitedAt: '2026-07-29T05:00:00.000Z',
      respondedAt: null,
      invitee: {
        id: 'synthetic-user-04',
        nickname: 'synthetic-contributor-04',
        name: '합성 지원자 4',
        avatarUrl: null,
      },
    },
  ];
}

export function searchCandidatesFor(
  query: string,
): readonly InvitationCandidate[] {
  const normalized = query.trim().toLowerCase();
  return SEARCH_CANDIDATES.filter(
    (candidate) =>
      candidate.nickname.toLowerCase().includes(normalized) ||
      (candidate.name?.toLowerCase().includes(normalized) ?? false),
  );
}

export function invitationFor(invitationId: string): TeamInvitation {
  return (
    RECEIVED_INVITATIONS.find(
      (invitation) => invitation.id === invitationId,
    ) ?? {
      id: invitationId,
      teamId: STUDENT_TEAM_ID,
      programId: 'program-capstone',
      invitedById: 'synthetic-user-01',
      status: 'PENDING',
      invitedAt: '2026-07-29T05:00:00.000Z',
      respondedAt: null,
    }
  );
}
