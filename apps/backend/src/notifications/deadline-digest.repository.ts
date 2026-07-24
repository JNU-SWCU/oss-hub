import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpcomingMilestone {
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
}

export interface DigestRecipient {
  readonly id: string;
  readonly notificationEmail: string;
}

export type DigestNotificationStatus = 'SENT' | 'FAILED';

export interface DeadlineDigestRepositoryPort {
  findUpcomingDeadlineMilestones(
    from: Date,
    to: Date,
  ): Promise<UpcomingMilestone[]>;
  findStaffRecipients(): Promise<DigestRecipient[]>;
  recordNotification(
    userId: string,
    status: DigestNotificationStatus,
    payload: Prisma.InputJsonValue,
  ): Promise<void>;
}

@Injectable()
export class DeadlineDigestRepository implements DeadlineDigestRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findUpcomingDeadlineMilestones(
    from: Date,
    to: Date,
  ): Promise<UpcomingMilestone[]> {
    const rows = await this.prisma.milestone.findMany({
      where: {
        dueAt: { gte: from, lte: to },
        program: { notifyOnDeadline: true },
      },
      select: {
        name: true,
        dueAt: true,
        program: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
    return rows.map((row) => ({
      programName: row.program.name,
      milestoneName: row.name,
      dueAt: row.dueAt,
    }));
  }

  async findStaffRecipients(): Promise<DigestRecipient[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        role: Role.STAFF,
        notifyEnabled: true,
        notificationEmail: { not: null },
      },
      select: { id: true, notificationEmail: true },
    });
    return rows.flatMap((row) =>
      row.notificationEmail
        ? [{ id: row.id, notificationEmail: row.notificationEmail }]
        : [],
    );
  }

  async recordNotification(
    userId: string,
    status: DigestNotificationStatus,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'DEADLINE_DIGEST',
        payload,
        channel: 'EMAIL',
        status,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    });
  }
}
