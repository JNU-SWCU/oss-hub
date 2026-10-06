import { TeamInvitationStatus } from '@prisma/client';
import { ReceivedTeamInvitationRecord } from '../team-invitations.repository';

export class ReceivedTeamInvitationResponseDto {
  id: string;
  teamId: string;
  programId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: string;
  respondedAt: string | null;
  teamName: string;
  programName: string;
  invitedByDisplayName: string;
  memberCount: number;
  teamMaxSize: number;

  private constructor(record: ReceivedTeamInvitationRecord) {
    this.id = record.id;
    this.teamId = record.teamId;
    this.programId = record.programId;
    this.invitedById = record.invitedById;
    this.status = record.status;
    this.invitedAt = record.invitedAt.toISOString();
    this.respondedAt = record.respondedAt?.toISOString() ?? null;
    this.teamName = record.teamName;
    this.programName = record.programName;
    this.invitedByDisplayName = record.invitedByDisplayName;
    this.memberCount = record.memberCount;
    this.teamMaxSize = record.teamMaxSize;
  }

  static from(
    record: ReceivedTeamInvitationRecord,
  ): ReceivedTeamInvitationResponseDto {
    return new ReceivedTeamInvitationResponseDto(record);
  }
}
