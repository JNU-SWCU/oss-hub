import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ApplicationStatus,
  RepositoryConnectionMode,
} from '@prisma/client';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from './repository-access-sync.config';

@Injectable()
export class PlatformRepository {
  programApplicationManagerWhere(userId: string) {
    return {
      leaderId: userId,
      members: { some: { userId } },
    };
  }

  programApplicationParticipantWhere(userId: string) {
    return {
      members: { some: { userId } },
    };
  }

  userProfileNameWhere(query: string) {
    return {
      name: { contains: query, mode: 'insensitive' as const },
    };
  }

  repositoryAccessSyncEventData(teamId: string, now: Date) {
    const requestedAt = now.toISOString();
    return {
      type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
      aggregateType: 'Team',
      aggregateId: teamId,
      idempotencyKey: `repository-access-sync:${teamId}:${requestedAt}`,
      payload: { teamId, requestedAt },
      availableAt: now,
    };
  }

  linkedRepoWhere() {
    return {
      teamRepos: { some: {} },
    } satisfies Prisma.RepoWhereInput;
  }

  collectionTargetRepoWhere() {
    return {
      teamRepos: {
        some: {
          validTo: null,
          team: { program: { lifecycle: { not: 'DELETED' } } },
        },
      },
    } satisfies Prisma.RepoWhereInput;
  }

  repositoryAccessSyncTargetWhere(teamId: string): Prisma.TeamWhereInput {
    return {
      id: teamId,
      status: ApplicationStatus.APPROVED,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      program: { repositoryProvisioningEnabled: true },
    };
  }

  async lockSubmissionMembership(
    tx: Prisma.TransactionClient,
    teamId: string,
    userId: string,
  ): Promise<boolean> {
    const coordinates: ApplicationCoordinates | null = await tx.team.findUnique(
      {
        where: { id: teamId },
        select: { programId: true, id: true },
      },
    );
    if (!coordinates) return false;

    const lockedPrograms = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Program" WHERE "id" = ${coordinates.programId} AND "lifecycle" <> 'DELETED' FOR UPDATE
  `);
    if (lockedPrograms.length === 0) return false;

    const lockedTeams = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Team" WHERE "id" = ${coordinates.id} FOR UPDATE
  `);
    if (lockedTeams.length === 0) return false;

    const current = await tx.team.findFirst({
      where: {
        id: teamId,
        ...this.programApplicationParticipantWhere(userId),
      },
      select: { id: true },
    });
    return current !== null;
  }

  async appendSubmissionReviewEvent(
    transaction: Pick<Prisma.TransactionClient, 'submissionHistory'>,
    input: SubmissionReviewEventInput,
  ) {
    const event = await transaction.submissionHistory.create({
      data: {
        submissionId: input.submissionId,
        event: input.decision,
        revision: input.revision,
        comment: input.comment,
        actorId: input.reviewerId,
        createdAt: input.reviewedAt,
      },
      select: {
        id: true,
        event: true,
        comment: true,
        createdAt: true,
        actor: { select: { nickname: true } },
      },
    });
    return event;
  }
}

type LockedRow = Readonly<{ id: string }>;

type ApplicationCoordinates = Readonly<{ programId: string; id: string }>;

interface SubmissionReviewEventInput {
  readonly submissionHistoryId: string;
  readonly submissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  readonly comment: string | null;
  readonly reviewedAt: Date;
}
