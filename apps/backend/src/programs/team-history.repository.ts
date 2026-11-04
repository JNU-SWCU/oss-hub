import type { Prisma, TeamInvitationStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';

interface InvitationSnapshot {
  readonly id: string;
  readonly teamId: string;
  readonly programId: string;
  readonly inviteeId: string;
  readonly invitedById: string;
  readonly createdAt: Date;
}

@Injectable()
export class TeamHistoryRepository {
  async archiveInvitation(
    transaction: Pick<Prisma.TransactionClient, 'teamHistory'>,
    invitation: InvitationSnapshot & {
      readonly status: TeamInvitationStatus;
      readonly respondedAt: Date | null;
      readonly updatedAt: Date;
    },
    actorId: string,
    occurredAt: Date,
  ): Promise<void> {
    const existing = await transaction.teamHistory.findUnique({
      where: {
        sourceTable_sourceId: {
          sourceTable: 'TeamInvitation',
          sourceId: invitation.id,
        },
      },
      select: { id: true },
    });
    if (existing) return;
    await transaction.teamHistory.create({
      data: {
        teamId: invitation.teamId,
        programId: invitation.programId,
        actorId,
        event: 'INVITATION_ARCHIVED',
        occurredAt,
        source: 'APPLICATION',
        sourceTable: 'TeamInvitation',
        sourceId: invitation.id,
        data: {
          schemaVersion: 1,
          reason: 'TEAM_DELETED',
          invitation: {
            id: invitation.id,
            inviteeId: invitation.inviteeId,
            invitedById: invitation.invitedById,
            createdAt: invitation.createdAt.toISOString(),
            status: invitation.status,
            respondedAt: invitation.respondedAt?.toISOString() ?? null,
            updatedAt: invitation.updatedAt.toISOString(),
          },
        },
      },
    });
  }

  async recordInvitationClosed(
    transaction: Pick<Prisma.TransactionClient, 'teamHistory'>,
    invitation: InvitationSnapshot,
    event:
      'INVITATION_ACCEPTED' | 'INVITATION_DECLINED' | 'INVITATION_CANCELLED',
    actorId: string,
    occurredAt: Date,
    reason?: 'JOINED_ANOTHER_TEAM' | 'TEAM_DELETED',
  ): Promise<void> {
    await transaction.teamHistory.create({
      data: {
        teamId: invitation.teamId,
        programId: invitation.programId,
        actorId,
        event,
        occurredAt,
        source: 'APPLICATION',
        sourceTable: 'TeamInvitation',
        sourceId: invitation.id,
        data: {
          schemaVersion: 1,
          invitation: {
            id: invitation.id,
            inviteeId: invitation.inviteeId,
            invitedById: invitation.invitedById,
            createdAt: invitation.createdAt.toISOString(),
          },
          ...(reason === undefined ? {} : { reason }),
        },
      },
    });
  }
}
