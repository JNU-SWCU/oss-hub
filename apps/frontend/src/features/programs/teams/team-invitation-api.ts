import { apiClient } from '@/lib/api-client';
import type {
  ReceivedTeamInvitation,
  SentTeamInvitation,
  InvitationCandidate,
  AcceptedTeamInvitation,
} from './team-invitation-dto';

export function listReceivedInvitations(): Promise<
  readonly ReceivedTeamInvitation[]
> {
  return apiClient<readonly ReceivedTeamInvitation[]>(
    'team-invitations/received',
  );
}

export function listSentInvitations(
  teamId: string,
): Promise<readonly SentTeamInvitation[]> {
  return apiClient<readonly SentTeamInvitation[]>(
    `team-invitations/teams/${encodeURIComponent(teamId)}/sent`,
  );
}

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
