import { apiClient } from '@/lib/api-client';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

export type TeamInvitationStatus =
  'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export interface TeamInvitation {
  readonly id: string;
  readonly teamId: string;
  readonly programId: string;
  readonly invitedById: string;
  readonly status: TeamInvitationStatus;
  readonly invitedAt: string;
  readonly respondedAt: string | null;
}

/** 내가 받은 초대 목록 항목. 팀·프로그램 화면에 필요한 요약은 서버가 함께 내려준다. */
export interface ReceivedTeamInvitation extends TeamInvitation {
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
}

/** 보낸 초대에만 실리는 초대 대상의 최소 표시 정보. 받은 초대 기본 모양에는 없다. */
export interface TeamInvitationInvitee {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** 팀이 보낸 초대 목록·생성 응답. `invitee`는 이 갈래에만 있다. */
export interface SentTeamInvitation extends TeamInvitation {
  readonly invitee: TeamInvitationInvitee;
}

/** 초대 대상 검색 결과 항목. 학번·이메일·연락처는 응답에 없다(백엔드 allowlist). */
export interface InvitationCandidate {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface AcceptedTeamInvitation {
  readonly teamId: string;
  readonly programId: string;
}

/** 내가 받은 초대 목록 — 전체 프로그램 대상, 화면에서 필요 시 programId로 좁힌다. */
export function listReceivedInvitations(): Promise<
  readonly ReceivedTeamInvitation[]
> {
  return apiClient<readonly ReceivedTeamInvitation[]>(
    'team-invitations/received',
  );
}

/** 팀이 보낸 초대 목록 — 팀 구성원만 조회하고 초대 변경은 팀장만 수행한다. */
export function listSentInvitations(
  teamId: string,
): Promise<readonly SentTeamInvitation[]> {
  return apiClient<readonly SentTeamInvitation[]>(
    `team-invitations/teams/${encodeURIComponent(teamId)}/sent`,
  );
}

/** 초대 대상 검색 — 닉네임/이름 검색어. */
export function searchInvitationCandidates(
  teamId: string,
  query: string,
): Promise<readonly InvitationCandidate[]> {
  const search = new URLSearchParams({ query });
  return apiClient<readonly InvitationCandidate[]>(
    `team-invitations/teams/${encodeURIComponent(teamId)}/search?${search.toString()}`,
  );
}

export function createInvitation(
  teamId: string,
  inviteeUserId: string,
): Promise<SentTeamInvitation> {
  return apiClient<SentTeamInvitation>(
    `team-invitations/teams/${encodeURIComponent(teamId)}/invitations`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ inviteeUserId }),
    },
  );
}

export function cancelInvitation(invitationId: string): Promise<void> {
  return apiClient<void>(
    `team-invitations/${encodeURIComponent(invitationId)}/cancel`,
    { method: 'POST' },
  );
}

export function declineInvitation(invitationId: string): Promise<void> {
  return apiClient<void>(
    `team-invitations/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' },
  );
}

export function acceptInvitation(
  invitationId: string,
): Promise<AcceptedTeamInvitation> {
  return apiClient<AcceptedTeamInvitation>(
    `team-invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' },
  );
}
