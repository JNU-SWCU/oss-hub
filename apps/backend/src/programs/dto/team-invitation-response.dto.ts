import { TeamInvitationStatus } from '@prisma/client';
import type {
  SentTeamInvitationRecord,
  TeamInvitationInvitee,
} from '../team-invitation.types';

export class TeamInvitationInviteeResponseDto {
  declare readonly id: string;
  declare readonly nickname: string;
  declare readonly name: string | null;
  declare readonly avatarUrl: string | null;

  static from(
    invitee: TeamInvitationInvitee,
  ): TeamInvitationInviteeResponseDto {
    return {
      id: invitee.id,
      nickname: invitee.nickname,
      name: invitee.name,
      avatarUrl: invitee.avatarUrl,
    };
  }
}

export class TeamInvitationResponseDto {
  declare readonly id: string;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly invitedById: string;
  declare readonly status: TeamInvitationStatus;
  declare readonly invitedAt: string;
  declare readonly respondedAt: string | null;
  declare readonly invitee: TeamInvitationInviteeResponseDto;

  static from(record: SentTeamInvitationRecord): TeamInvitationResponseDto {
    return {
      id: record.id,
      teamId: record.teamId,
      programId: record.programId,
      invitedById: record.invitedById,
      status: record.status,
      invitedAt: record.invitedAt.toISOString(),
      respondedAt: record.respondedAt?.toISOString() ?? null,
      invitee: TeamInvitationInviteeResponseDto.from(record.invitee),
    };
  }
}
