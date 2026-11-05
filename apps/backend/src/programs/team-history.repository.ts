import { type Prisma, ApplicationReviewEventKind } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { ApplicationReviewHistoryTargetMissingError } from './review-history-writer.error';

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

export type ReviewHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'application' | 'applicationReviewHistory'
>;

export interface AppendReviewHistoryInput {
  readonly applicationId: string;
  readonly eventKind: ApplicationReviewEventKind;

  readonly actorId: string;
  readonly occurredAt: Date;

  readonly rejectionReason: string | null;
}

export interface AppendedReviewHistory {
  readonly revision: number;
}

@Injectable()
export class ReviewHistoryWriterRepository {
  async appendReviewHistory(
    client: ReviewHistoryWriterClient,
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    const revision = await resolveRevision(client, input);
    await client.applicationReviewHistory.create({
      data: {
        applicationId: input.applicationId,
        eventKind: input.eventKind,
        revision,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        rejectionReason:
          input.eventKind === ApplicationReviewEventKind.REJECTED
            ? input.rejectionReason
            : null,
      },
    });
    return { revision };
  }
}

async function resolveRevision(
  client: ReviewHistoryWriterClient,
  input: AppendReviewHistoryInput,
): Promise<number> {
  if (input.eventKind === ApplicationReviewEventKind.RESUBMITTED) {
    const bumped = await client.application.update({
      where: { id: input.applicationId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
    return bumped.revision;
  }
  const current = await client.application.findUnique({
    where: { id: input.applicationId },
    select: { revision: true },
  });
  if (current === null) {
    throw new ApplicationReviewHistoryTargetMissingError(input.applicationId);
  }
  return current.revision;
}
