import { AcceptedInvitationResult } from '../team-invitations.service';

/** `POST /team-invitations/:id/accept` 응답 — 새로 합류한 팀·프로그램을 알린다. */
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
