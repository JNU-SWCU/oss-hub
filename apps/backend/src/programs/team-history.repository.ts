import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { TeamHistoryEvent, type Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { ApplicationReviewHistoryTargetMissingError } from './teams.error';

export interface AppendReviewHistoryInput {
  readonly teamId: string;
  readonly eventKind: TeamHistoryEvent;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly rejectionReason: string | null;
}

export interface AppendedReviewHistory {
  readonly revision: number;
}

export type ReviewHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'team' | 'teamHistory'
>;

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
  private readonly boundedReads = new BoundedReadRepository();

  async appendReviewHistory(
    client: ReviewHistoryWriterClient,
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    const team =
      input.eventKind === TeamHistoryEvent.RESUBMITTED
        ? await client.team.update({
            where: { id: input.teamId },
            data: { revision: { increment: 1 } },
            select: { revision: true, programId: true },
          })
        : await client.team.findUnique({
            where: { id: input.teamId },
            select: { revision: true, programId: true },
          });
    if (team === null)
      throw new ApplicationReviewHistoryTargetMissingError(input.teamId);
    await client.teamHistory.create({
      data: {
        teamId: input.teamId,
        programId: team.programId,
        actorId: input.actorId,
        event: input.eventKind,
        occurredAt: input.occurredAt,
        source: 'APPLICATION',
        data: {
          schemaVersion: 1,
          revision: team.revision,
          rejectionReason:
            input.eventKind === TeamHistoryEvent.REJECTED
              ? input.rejectionReason
              : null,
        },
      },
    });
    return { revision: team.revision };
  }

  async recordDeleted(
    transaction: Pick<Prisma.TransactionClient, 'team' | 'teamHistory'>,
    teamId: string,
    actorId: string,
    reason: 'CANCELLED' | 'LAST_MEMBER_LEFT' | 'STAFF_DELETED',
    deletedCounts: Prisma.InputJsonObject,
    occurredAt: Date,
  ): Promise<void> {
    const team = await transaction.team
      .findUniqueOrThrow({
        where: { id: teamId },
        select: {
          name: true,
          programId: true,
          leaderId: true,
          status: true,
          members: {
            take: READ_CAP.membersPerTeam + 1,
            orderBy: { userId: 'asc' },
            select: {
              userId: true,
              user: { select: { name: true, nickname: true } },
            },
          },
        },
      })
      .then((result) =>
        this.boundedReads.assertNestedWithin(
          result,
          { members: READ_CAP.membersPerTeam },
          'Team.findUniqueOrThrow',
        ),
      );
    await transaction.teamHistory.create({
      data: {
        teamId,
        programId: team.programId,
        actorId,
        event: 'DELETED',
        occurredAt,
        source: 'APPLICATION',
        data: {
          schemaVersion: 1,
          reason,
          name: team.name,
          leaderId: team.leaderId,
          status: team.status,
          members: team.members.map((member) => ({
            userId: member.userId,
            name: member.user.name,
            nickname: member.user.nickname,
          })),
          deletedCounts,
        },
      },
    });
  }

  async recordTeamInvitationsDeleted(
    transaction: Pick<
      Prisma.TransactionClient,
      'teamInvitation' | 'teamHistory'
    >,
    teamId: string,
    actorId: string,
    occurredAt: Date,
  ): Promise<void> {
    const invitations = await this.boundedReads.readCapped(
      READ_CAP.invitationsPerTeam,
      'TeamInvitation per team',
      (take) =>
        transaction.teamInvitation.findMany({
          take,
          where: { teamId },
          orderBy: { id: 'asc' },
        }),
    );
    await this.recordInvitationsClosed(
      transaction,
      invitations,
      'INVITATION_CANCELLED',
      actorId,
      occurredAt,
      'TEAM_DELETED',
    );
  }

  async recordInvitationClosed(
    transaction: Pick<Prisma.TransactionClient, 'teamHistory'>,
    invitation: InvitationSnapshot,
    event: InvitationClosedEvent,
    actorId: string,
    occurredAt: Date,
    reason?: InvitationClosedReason,
  ): Promise<void> {
    await this.recordInvitationsClosed(
      transaction,
      [invitation],
      event,
      actorId,
      occurredAt,
      reason,
    );
  }

  async recordInvitationsClosed(
    transaction: Pick<Prisma.TransactionClient, 'teamHistory'>,
    invitations: readonly InvitationSnapshot[],
    event: InvitationClosedEvent,
    actorId: string,
    occurredAt: Date,
    reason?: InvitationClosedReason,
  ): Promise<void> {
    if (invitations.length === 0) return;
    await transaction.teamHistory.createMany({
      data: invitations.map((invitation) => ({
        teamId: invitation.teamId,
        programId: invitation.programId,
        actorId,
        event,
        occurredAt,
        source: 'APPLICATION' as const,
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
      })),
    });
  }
}

type InvitationClosedEvent =
  'INVITATION_ACCEPTED' | 'INVITATION_DECLINED' | 'INVITATION_CANCELLED';

type InvitationClosedReason = 'JOINED_ANOTHER_TEAM' | 'TEAM_DELETED';
