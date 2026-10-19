import { apiClient } from '@/lib/api-client';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

type TeamInvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

interface TeamInvitation {
  readonly preparation?: true;
  readonly id: string;
  readonly teamId: string;
  readonly programId: string;
  readonly invitedById: string;
  readonly status: TeamInvitationStatus;
  readonly invitedAt: string;
  readonly respondedAt: string | null;
}

export interface ReceivedTeamInvitation extends TeamInvitation {
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
}

interface TeamInvitationInvitee {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface SentTeamInvitation extends TeamInvitation {
  readonly invitee: TeamInvitationInvitee;
}

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

export function listReceivedInvitations(): Promise<
  readonly ReceivedTeamInvitation[]
> {
  return apiClient<readonly ReceivedTeamInvitation[]>(
    'team-invitations/received',
  );
}

export function listSentInvitations(
  teamId: string,
  preparation = false,
): Promise<readonly SentTeamInvitation[]> {
  return apiClient<readonly SentTeamInvitation[]>(
    `${preparation ? 'application-preparations' : 'team-invitations/teams'}/${encodeURIComponent(teamId)}/sent`,
  );
}

export function searchInvitationCandidates(
  teamId: string,
  query: string,
  preparation = false,
): Promise<readonly InvitationCandidate[]> {
  const search = new URLSearchParams({ query });
  return apiClient<readonly InvitationCandidate[]>(
    `${preparation ? 'application-preparations' : 'team-invitations/teams'}/${encodeURIComponent(teamId)}/search?${search.toString()}`,
  );
}

export function createInvitation(
  teamId: string,
  inviteeUserId: string,
  preparation = false,
): Promise<SentTeamInvitation> {
  return apiClient<SentTeamInvitation>(
    `${preparation ? 'application-preparations' : 'team-invitations/teams'}/${encodeURIComponent(teamId)}/invitations`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ inviteeUserId }),
    },
  );
}

export function cancelInvitation(
  invitationId: string,
  preparation = false,
): Promise<void> {
  return apiClient<void>(
    `${preparation ? 'application-preparations/invitations' : 'team-invitations'}/${encodeURIComponent(invitationId)}/cancel`,
    { method: 'POST' },
  );
}

export function declineInvitation(
  invitationId: string,
  preparation = false,
): Promise<void> {
  return apiClient<void>(
    `${preparation ? 'application-preparations/invitations' : 'team-invitations'}/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' },
  );
}

export function acceptInvitation(
  invitationId: string,
  preparation = false,
): Promise<AcceptedTeamInvitation> {
  return apiClient<AcceptedTeamInvitation>(
    `${preparation ? 'application-preparations/invitations' : 'team-invitations'}/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' },
  );
}
