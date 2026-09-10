import { TeamInvitationStatus } from '@prisma/client';
import type {
  SentTeamInvitationRecord,
  TeamInvitationInvitee,
} from '../team-invitations.repository';

/** 보낸 초대 응답에 포함하는 초대 대상의 최소 표시 정보. */
export class TeamInvitationInviteeResponseDto {
  id: string;
  nickname: string;
  name: string | null;
  avatarUrl: string | null;

  private constructor(invitee: TeamInvitationInvitee) {
    this.id = invitee.id;
    this.nickname = invitee.nickname;
    this.name = invitee.name;
    this.avatarUrl = invitee.avatarUrl;
  }

  static from(
    invitee: TeamInvitationInvitee,
  ): TeamInvitationInviteeResponseDto {
    return new TeamInvitationInviteeResponseDto(invitee);
  }
}

/** `GET /team-invitations/teams/:teamId/sent` 및 생성 응답 항목 하나. */
export class TeamInvitationResponseDto {
  id: string;
  teamId: string;
  programId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: string;
  respondedAt: string | null;
  invitee: TeamInvitationInviteeResponseDto;

  private constructor(record: SentTeamInvitationRecord) {
    this.id = record.id;
    this.teamId = record.teamId;
    this.programId = record.programId;
    this.invitedById = record.invitedById;
    this.status = record.status;
    this.invitedAt = record.invitedAt.toISOString();
    this.respondedAt = record.respondedAt?.toISOString() ?? null;
    this.invitee = TeamInvitationInviteeResponseDto.from(record.invitee);
  }

  static from(record: SentTeamInvitationRecord): TeamInvitationResponseDto {
    return new TeamInvitationResponseDto(record);
  }
}
