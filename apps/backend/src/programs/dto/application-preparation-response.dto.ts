import type {
  PreparationInvitation,
  PreparationView,
} from '../application-preparation.error';

export class ApplicationPreparationResponseDto {
  static from(preparation: PreparationView) {
    return {
      ...preparation,
      preparation: true,
      hasApplication: false,
      canInvite: preparation.isLeader,
      canRemoveMembers: preparation.isLeader,
      canLeave: !preparation.isLeader,
    };
  }
}

export class ApplicationPreparationInvitationResponseDto {
  static from(invitation: PreparationInvitation) {
    return {
      ...invitation,
      preparation: true,
      invitedAt: invitation.invitedAt.toISOString(),
      respondedAt: invitation.respondedAt?.toISOString() ?? null,
    };
  }
}
