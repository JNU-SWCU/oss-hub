import { TeamInvitationStatus } from '@prisma/client';
import { TeamInvitationRecord } from '../team-invitations.repository';

/** `GET /team-invitations/received` 응답 목록 항목 하나. */
export class TeamInvitationResponseDto {
  id: string;
  teamId: string;
  programId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: string;
  respondedAt: string | null;

  private constructor(record: TeamInvitationRecord) {
    this.id = record.id;
    this.teamId = record.teamId;
    this.programId = record.programId;
    this.invitedById = record.invitedById;
    this.status = record.status;
    this.invitedAt = record.invitedAt.toISOString();
    this.respondedAt = record.respondedAt?.toISOString() ?? null;
  }

  static from(record: TeamInvitationRecord): TeamInvitationResponseDto {
    return new TeamInvitationResponseDto(record);
  }
}
