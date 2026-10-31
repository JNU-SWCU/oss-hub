import { TeamInvitationStatus } from '@prisma/client';
import type { ReceivedTeamInvitationRecord } from '../team-invitation.types';

export class ReceivedTeamInvitationResponseDto {
  declare readonly preparation?: true;
  declare readonly id: string;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly invitedById: string;
  declare readonly status: TeamInvitationStatus;
  declare readonly invitedAt: string;
  declare readonly respondedAt: string | null;
  declare readonly teamName: string;
  declare readonly programName: string;
  declare readonly invitedByDisplayName: string;
  declare readonly memberCount: number;
  declare readonly teamMaxSize: number;

  static from(
    record: ReceivedTeamInvitationRecord,
  ): ReceivedTeamInvitationResponseDto {
    return {
      preparation: record.preparation ? true : undefined,
      id: record.id,
      teamId: record.teamId,
      programId: record.programId,
      invitedById: record.invitedById,
      status: record.status,
      invitedAt: record.invitedAt.toISOString(),
      respondedAt: record.respondedAt?.toISOString() ?? null,
      teamName: record.teamName,
      programName: record.programName,
      invitedByDisplayName: record.invitedByDisplayName,
      memberCount: record.memberCount,
      teamMaxSize: record.teamMaxSize,
    };
  }
}
