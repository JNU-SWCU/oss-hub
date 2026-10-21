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
