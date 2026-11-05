import type { Prisma } from '@prisma/client';
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
  async recordTeamInvitationsDeleted(
    transaction: Pick<
      Prisma.TransactionClient,
      'teamInvitation' | 'teamHistory'
    >,
    teamId: string,
    actorId: string,
    occurredAt: Date,
  ): Promise<void> {
    const invitations = await transaction.teamInvitation.findMany({
      where: { teamId },
      orderBy: { id: 'asc' },
    });
    for (const invitation of invitations) {
      await this.recordInvitationClosed(
        transaction,
        invitation,
        'INVITATION_CANCELLED',
        actorId,
        occurredAt,
        'TEAM_DELETED',
      );
    }
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
