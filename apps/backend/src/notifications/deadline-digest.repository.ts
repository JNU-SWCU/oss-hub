import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, ApplicationStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpcomingMilestone {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
}

export interface MissingSubmitter {
  readonly id: string;
  readonly nickname: string;
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
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
  findMissingSubmitters(
    milestones: readonly UpcomingMilestone[],
  ): Promise<ReadonlyMap<string, MissingSubmitter[]>>;
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
        id: true,
        programId: true,
        name: true,
        dueAt: true,
        program: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      programId: row.programId,
      programName: row.program.name,
      milestoneName: row.name,
      dueAt: row.dueAt,
    }));
  }
  async findMissingSubmitters(
    milestones: readonly UpcomingMilestone[],
  ): Promise<ReadonlyMap<string, MissingSubmitter[]>> {
    const missingByMilestone = new Map(
      milestones.map((milestone) => [milestone.id, [] as MissingSubmitter[]]),
    );
    if (milestones.length === 0) {
      return missingByMilestone;
    }

    const rows = await this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        programId: {
          in: [...new Set(milestones.map((milestone) => milestone.programId))],
        },
      },
      select: {
        programId: true,
        applicant: {
          select: {
            id: true,
            nickname: true,
            notificationEmail: true,
            notifyEnabled: true,
          },
        },
        team: {
          select: {
            members: {
              select: {
                user: {
                  select: {
                    id: true,
                    nickname: true,
                    notificationEmail: true,
                    notifyEnabled: true,
                  },
                },
              },
            },
          },
        },
        submissions: {
          where: {
            milestoneId: { in: milestones.map((milestone) => milestone.id) },
          },
          select: { milestoneId: true },
        },
      },
    });

    for (const milestone of milestones) {
      const missingSubmitters = missingByMilestone.get(milestone.id);
      if (!missingSubmitters) {
        continue;
      }
      for (const application of rows) {
        if (
          application.programId !== milestone.programId ||
          application.submissions.some(
            (submission) => submission.milestoneId === milestone.id,
          )
        ) {
          continue;
        }
        if (application.team) {
          missingSubmitters.push(
            ...application.team.members.map((member) => member.user),
          );
        } else {
          missingSubmitters.push(application.applicant);
        }
      }
    }

    return missingByMilestone;
  }

  async findStaffRecipients(): Promise<DigestRecipient[]> {
    // 발송 대상은 STAFF·ADMIN 교직원만. 설정 API 자체는 역할 무관(#156).
    const rows = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.STAFF, Role.ADMIN] },
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
