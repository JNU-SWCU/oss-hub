import type { ReceivedTeamInvitationRecord } from '../team-invitations.repository';

export class ReceivedTeamInvitationResponseDto {
  declare readonly id: string;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly invitedById: string;
  declare readonly invitedAt: string;
  declare readonly teamName: string;
  declare readonly programName: string;
  declare readonly invitedByDisplayName: string;
  declare readonly memberCount: number;
  declare readonly teamMaxSize: number;

  static from(
    record: ReceivedTeamInvitationRecord,
  ): ReceivedTeamInvitationResponseDto {
    return {
      id: record.id,
      teamId: record.teamId,
      programId: record.programId,
      invitedById: record.invitedById,
      invitedAt: record.invitedAt.toISOString(),
      teamName: record.teamName,
      programName: record.programName,
      invitedByDisplayName: record.invitedByDisplayName,
      memberCount: record.memberCount,
      teamMaxSize: record.teamMaxSize,
    };
  }
}
