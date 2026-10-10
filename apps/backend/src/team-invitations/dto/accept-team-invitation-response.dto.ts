import type { AcceptedInvitationResult } from '../domain/team-invitation';

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
