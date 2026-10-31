import type { AcceptedInvitationResult } from '../team-invitation.types';

export class AcceptTeamInvitationResponseDto {
  declare readonly teamId: string;
  declare readonly programId: string;

  static from(
    result: AcceptedInvitationResult,
  ): AcceptTeamInvitationResponseDto {
    return { teamId: result.teamId, programId: result.programId };
  }
}
