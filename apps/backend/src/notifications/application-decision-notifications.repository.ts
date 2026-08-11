import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
      WHERE account."githubId" = ${githubId}
        AND source."type" = 'APPLICATION_DECISION'
        AND source."channel" = 'IN_APP'
        AND source."status" = 'UNREAD'
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
