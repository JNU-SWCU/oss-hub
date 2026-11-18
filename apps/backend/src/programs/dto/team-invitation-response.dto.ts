import type {
  SentTeamInvitationRecord,
  TeamInvitationInvitee,
} from '../team-invitations.repository';

export class TeamInvitationInviteeResponseDto {
  declare readonly id: string;
  declare readonly nickname: string;
  declare readonly name: string | null;

  static from(
    invitee: TeamInvitationInvitee,
  ): TeamInvitationInviteeResponseDto {
    return {
      id: invitee.id,
      nickname: invitee.nickname,
      name: invitee.name,
    };
  }
}

export class TeamInvitationResponseDto {
  declare readonly id: string;
  declare readonly invitee: TeamInvitationInviteeResponseDto;

  static from(record: SentTeamInvitationRecord): TeamInvitationResponseDto {
    return {
      id: record.id,
      invitee: TeamInvitationInviteeResponseDto.from(record.invitee),
    };
  }
}
