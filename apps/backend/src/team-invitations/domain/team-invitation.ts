import { TeamInvitationStatus } from '@prisma/client';

export interface TeamInvitationRecord {
  id: string;
  teamId: string;
  programId: string;
  inviteeId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

export interface TeamInvitationInvitee {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface SentTeamInvitationRecord extends TeamInvitationRecord {
  readonly invitee: TeamInvitationInvitee;
}

export interface ReceivedTeamInvitationRecord extends TeamInvitationRecord {
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
}

export interface TeamContextRecord {
  readonly teamId: string;
  readonly programId: string;
  readonly leaderId: string;
  readonly teamMaxSize: number;
}

export interface CreateInvitationInput {
  readonly teamId: string;

  readonly actorId: string;
  readonly inviteeId: string;
}

export type CreateInvitationOutcome =
  | { readonly kind: 'team-not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-team-member' }
  | { readonly kind: 'invitee-already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'already-invited' }
  | {
      readonly kind: 'ok';
      readonly invitation: SentTeamInvitationRecord;
    };

export type CancelInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

export type DeclineInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

export interface InvitationCandidateRecord {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export type InviteeEligibility = 'eligible' | 'not-found' | 'not-eligible';

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'invitee-not-eligible' }
  | {
      readonly kind: 'ok';
      readonly teamId: string;
      readonly programId: string;
    };

export type AcceptInvitationOkContext = {
  readonly teamId: string;
  readonly programId: string;
  readonly teamName: string;
  readonly programName: string;
};

export interface AcceptedInvitationResult {
  readonly teamId: string;
  readonly programId: string;
}
