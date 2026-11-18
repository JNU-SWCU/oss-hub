import type { AcceptedInvitationResult } from '../team-invitations.repository';

export class AcceptTeamInvitationResponseDto {
  declare readonly programId: string;

  static from(
    result: AcceptedInvitationResult,
  ): AcceptTeamInvitationResponseDto {
    return { programId: result.programId };
  }
}
