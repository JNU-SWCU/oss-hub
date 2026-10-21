import { apiClient } from '@/lib/api-client';
import type {
  ReceivedTeamInvitation,
  SentTeamInvitation,
  InvitationCandidate,
  AcceptedTeamInvitation,
} from './team-invitation-dto';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

const teamBase = (preparation: boolean) =>
  preparation ? 'application-preparations' : 'team-invitations/teams';

const invitationBase = (preparation: boolean) =>
  preparation ? 'application-preparations/invitations' : 'team-invitations';

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
    `${teamBase(preparation)}/${encodeURIComponent(teamId)}/sent`,
  );
}

export function searchInvitationCandidates(
  teamId: string,
  query: string,
  preparation = false,
): Promise<readonly InvitationCandidate[]> {
  const search = new URLSearchParams({ query });
  return apiClient<readonly InvitationCandidate[]>(
    `${teamBase(preparation)}/${encodeURIComponent(teamId)}/search?${search.toString()}`,
  );
}

export function createInvitation(
  teamId: string,
  inviteeUserId: string,
  preparation = false,
): Promise<SentTeamInvitation> {
  return apiClient<SentTeamInvitation>(
    `${teamBase(preparation)}/${encodeURIComponent(teamId)}/invitations`,
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
    `${invitationBase(preparation)}/${encodeURIComponent(invitationId)}/cancel`,
    { method: 'POST' },
  );
}

export function declineInvitation(
  invitationId: string,
  preparation = false,
): Promise<void> {
  return apiClient<void>(
    `${invitationBase(preparation)}/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' },
  );
}

export function acceptInvitation(
  invitationId: string,
  preparation = false,
): Promise<AcceptedTeamInvitation> {
  return apiClient<AcceptedTeamInvitation>(
    `${invitationBase(preparation)}/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' },
  );
}
