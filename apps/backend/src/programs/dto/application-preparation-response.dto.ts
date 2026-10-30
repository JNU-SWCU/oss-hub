import type {
  PreparationInvitation,
  PreparationView,
} from '../application-preparation.error';

export class ApplicationPreparationResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly minMembers: number;
  declare readonly maxMembers: number;
  declare readonly isLeader: boolean;
  declare readonly members: PreparationView['members'];
  declare readonly preparation: true;
  declare readonly hasApplication: false;
  declare readonly canInvite: boolean;
  declare readonly canRemoveMembers: boolean;
  declare readonly canLeave: boolean;

  static from(preparation: PreparationView): ApplicationPreparationResponseDto {
    return {
      id: preparation.id,
      name: preparation.name,
      memberCount: preparation.memberCount,
      minMembers: preparation.minMembers,
      maxMembers: preparation.maxMembers,
      isLeader: preparation.isLeader,
      members: preparation.members,
      preparation: true,
      hasApplication: false,
      canInvite: preparation.isLeader,
      canRemoveMembers: preparation.isLeader,
      canLeave: !preparation.isLeader,
    };
  }
}

export class ApplicationPreparationInvitationResponseDto {
  declare readonly id: string;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly invitedById: string;
  declare readonly status: PreparationInvitation['status'];
  declare readonly invitedAt: string;
  declare readonly respondedAt: string | null;
  declare readonly teamName: string;
  declare readonly programName: string;
  declare readonly invitedByDisplayName: string;
  declare readonly memberCount: number;
  declare readonly teamMaxSize: number;
  declare readonly invitee: PreparationInvitation['invitee'];
  declare readonly preparation: true;

  static from(
    invitation: PreparationInvitation,
  ): ApplicationPreparationInvitationResponseDto {
    return {
      id: invitation.id,
      teamId: invitation.teamId,
      programId: invitation.programId,
      invitedById: invitation.invitedById,
      status: invitation.status,
      invitedAt: invitation.invitedAt.toISOString(),
      respondedAt: invitation.respondedAt?.toISOString() ?? null,
      teamName: invitation.teamName,
      programName: invitation.programName,
      invitedByDisplayName: invitation.invitedByDisplayName,
      memberCount: invitation.memberCount,
      teamMaxSize: invitation.teamMaxSize,
      invitee: invitation.invitee,
      preparation: true,
    };
  }
}
