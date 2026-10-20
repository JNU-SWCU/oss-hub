import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoredApplicationDecisionNotification {
  readonly id: string;
  readonly payload: Prisma.JsonValue;
  readonly createdAt: Date;
}

export interface ApplicationDecisionNotificationsRepositoryPort {
  listUnread(
    githubId: bigint,
  ): Promise<readonly StoredApplicationDecisionNotification[]>;
  markRead(githubId: bigint, notificationId: string): Promise<void>;
  listUnreadTeamDeletions(
    githubId: bigint,
  ): Promise<readonly StoredApplicationDecisionNotification[]>;
  markTeamDeletionRead(githubId: bigint, notificationId: string): Promise<void>;
}

@Injectable()
export class ApplicationDecisionNotificationsRepository implements ApplicationDecisionNotificationsRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listUnread(
    githubId: bigint,
  ): Promise<readonly StoredApplicationDecisionNotification[]> {
    return this.prisma.$queryRaw<
      readonly StoredApplicationDecisionNotification[]
    >(Prisma.sql`
      SELECT source."id", source."payload", source."createdAt"
      FROM "Notification" AS source
      INNER JOIN "User" AS account ON account."id" = source."userId"
      INNER JOIN "Application" AS application
        ON application."id" = source."payload"->>'applicationId'
        AND application."programId" = source."payload"->>'programId'
        AND application."status"::text = source."payload"->>'decision'
        AND source."payload"->>'decidedAt' >=
          to_char(application."submittedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      WHERE account."githubId" = ${githubId}
        AND source."type" = 'APPLICATION_DECISION'
        AND source."channel" = 'IN_APP'
        AND source."status" = 'UNREAD'
        AND NOT EXISTS (
          SELECT 1 FROM "Notification" AS later
          WHERE later."userId" = source."userId"
            AND later."type" = 'APPLICATION_DECISION'
            AND later."channel" = 'IN_APP'
            AND later."payload"->>'applicationId' = source."payload"->>'applicationId'
            AND (later."payload"->>'decidedAt', later."createdAt", later."id") >
              (source."payload"->>'decidedAt', source."createdAt", source."id")
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "Notification" AS acknowledgement
          WHERE acknowledgement."userId" = source."userId"
            AND acknowledgement."type" = 'APPLICATION_DECISION_ACKNOWLEDGED'
            AND acknowledgement."channel" = 'IN_APP'
            AND acknowledgement."status" = 'READ'
            AND acknowledgement."idempotencyKey" =
              'application-decision-acknowledged:' || source."id"
        )
      ORDER BY source."createdAt" ASC, source."id" ASC
      LIMIT 50
    `);
  }

  listUnreadTeamDeletions(
    githubId: bigint,
  ): Promise<readonly StoredApplicationDecisionNotification[]> {
    return this.prisma.notification.findMany({
      where: {
        user: { githubId },
        type: 'TEAM_DELETED',
        channel: 'IN_APP',
        status: 'UNREAD',
      },
      select: { id: true, payload: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  }

  async markTeamDeletionRead(
    githubId: bigint,
    notificationId: string,
  ): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        user: { githubId },
        type: 'TEAM_DELETED',
        channel: 'IN_APP',
        status: 'UNREAD',
      },
      data: { status: 'READ' },
    });
  }

  async markRead(githubId: bigint, notificationId: string): Promise<void> {
    const source = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        user: { githubId },
        type: 'APPLICATION_DECISION',
        channel: 'IN_APP',
        status: 'UNREAD',
      },
      select: { userId: true },
    });
    if (!source) return;

    await this.prisma.notification.createMany({
      data: {
        userId: source.userId,
        type: 'APPLICATION_DECISION_ACKNOWLEDGED',
        channel: 'IN_APP',
        status: 'READ',
        payload: { schemaVersion: 1, notificationId },
        idempotencyKey: `application-decision-acknowledged:${notificationId}`,
      },
      skipDuplicates: true,
    });
  }
}
