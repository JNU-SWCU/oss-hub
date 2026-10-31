import type { AcceptedInvitationResult } from '../team-invitations.repository';

export class AcceptTeamInvitationResponseDto {
  declare readonly teamId: string;
  declare readonly programId: string;

  static from(
    result: AcceptedInvitationResult,
  ): AcceptTeamInvitationResponseDto {
    return { teamId: result.teamId, programId: result.programId };
  }
}
