export interface ReceivedTeamInvitation {
  readonly id: string;
  readonly programId: string;
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
}

export interface SentTeamInvitation {
  readonly id: string;
  readonly invitee: TeamInvitationInvitee;
}

export interface InvitationCandidate {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
}

export interface AcceptedTeamInvitation {
  readonly programId: string;
}
