import { AcceptedInvitationResult } from '../team-invitations.service';

export class AcceptTeamInvitationResponseDto {
  teamId: string;
  programId: string;

  private constructor(result: AcceptedInvitationResult) {
    this.teamId = result.teamId;
    this.programId = result.programId;
  }

  static from(
    result: AcceptedInvitationResult,
  ): AcceptTeamInvitationResponseDto {
    return new AcceptTeamInvitationResponseDto(result);
  }
}
