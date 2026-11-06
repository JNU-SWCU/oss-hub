import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, ApplicationStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
export type NotifiableStaffRecipient = {
  readonly id: string;
  readonly notificationEmail: string;
};
export type DeadlineWindow = {
  readonly from: Date;
  readonly to: Date;
};
export type DeadlineRecipientSource = {
  readonly id: string;
  readonly nickname: string;
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
  readonly accountStatus: AccountStatus;
};
export type DeadlineProgramSource = {
  readonly id: string;
  readonly name: string;
  readonly notifyOnDeadline: boolean;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly requirements: readonly {
      readonly id: string;
      readonly required: boolean;
    }[];
  }[];
  readonly teams: readonly {
    readonly id: string;
    readonly applicant: DeadlineRecipientSource;
    readonly members: readonly DeadlineRecipientSource[];
    readonly submittedDocumentIds: readonly string[];
  }[];
};
export type DigestNotificationStatus = 'SENT' | 'FAILED';
export interface DeadlineDigestRepositoryPort {
  findAutomaticProgramIds(window: DeadlineWindow): Promise<readonly string[]>;
  findDeadlineProgram(programId: string): Promise<DeadlineProgramSource | null>;
  findNotifiableStaff(): Promise<readonly NotifiableStaffRecipient[]>;
  claimNotification(
    userId: string,
    idempotencyKey: string,
    payload: Prisma.InputJsonValue,
  ): Promise<boolean>;
  completeNotification(
    idempotencyKey: string,
    status: DigestNotificationStatus,
    payload: Prisma.InputJsonValue,
  ): Promise<void>;
}
const deadlineRecipientSelect = {
  id: true,
  nickname: true,
  notificationEmail: true,
  notifyEnabled: true,
  accountStatus: true,
} satisfies Prisma.UserSelect;
@Injectable()
export class DeadlineDigestRepository implements DeadlineDigestRepositoryPort {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}
  async findAutomaticProgramIds(
    window: DeadlineWindow,
  ): Promise<readonly string[]> {
    const programs = await this.prisma.program.findMany({
      where: {
        notifyOnDeadline: true,
        lifecycle: { not: 'DELETED' },
        milestones: {
          some: {
            dueAt: { gte: window.from, lte: window.to },
            requirements: {
              some: {
                required: true,
              },
            },
          },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return programs.map((program) => program.id);
  }
  async findDeadlineProgram(
    programId: string,
  ): Promise<DeadlineProgramSource | null> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        notifyOnDeadline: true,
        milestones: {
          select: {
            id: true,
            name: true,
            dueAt: true,
            requirements: {
              where: {},
              select: { id: true, required: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        },
        teams: {
          where: { status: ApplicationStatus.APPROVED },
          select: {
            id: true,
            applicant: { select: deadlineRecipientSelect },
            members: {
              select: { user: { select: deadlineRecipientSelect } },
              orderBy: { userId: 'asc' },
            },
            submissions: {
              select: { requirementId: true },
              orderBy: { requirementId: 'asc' },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (program === null) return null;
    return {
      id: program.id,
      name: program.name,
      notifyOnDeadline: program.notifyOnDeadline,
      milestones: program.milestones,
      teams: program.teams.map((application) => ({
        id: application.id,
        applicant: application.applicant,
        members: application.members.map(
          (member): DeadlineRecipientSource => member.user,
        ),
        submittedDocumentIds: application.submissions.map(
          (submission) => submission.requirementId,
        ),
      })),
    };
  }
  async findNotifiableStaff(): Promise<readonly NotifiableStaffRecipient[]> {
    const staff = await this.prisma.user.findMany({
      where: {
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        profileCreatedAt: { not: null },
        name: { not: null },
        department: { not: null },
        accountStatus: AccountStatus.ACTIVE,
        notifyEnabled: true,
        notificationEmail: { not: null },
      },
      select: { id: true, notificationEmail: true },
      orderBy: { id: 'asc' },
    });
    return staff.flatMap(({ id, notificationEmail }) =>
      notificationEmail === null ? [] : [{ id, notificationEmail }],
    );
  }
  async claimNotification(
    userId: string,
    idempotencyKey: string,
    payload: Prisma.InputJsonValue,
  ): Promise<boolean> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          idempotencyKey,
          type: 'DEADLINE_DIGEST',
          payload,
          channel: 'EMAIL',
          status: 'PENDING',
        },
      });
      return true;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }
  async completeNotification(
    idempotencyKey: string,
    status: DigestNotificationStatus,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.notification.update({
      where: { idempotencyKey },
      data: {
        status,
        payload,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    });
  }
  findFailedNotifications(): Promise<
    readonly {
      readonly id: string;
      readonly createdAt: Date;
      readonly payload: Prisma.JsonValue;
    }[]
  > {
    return this.prisma.notification.findMany({
      where: { type: 'DEADLINE_DIGEST', status: 'FAILED' },
      select: { id: true, createdAt: true, payload: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async findActiveAdmin(githubId: bigint): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        admin: { select: { userId: true } },
        accountStatus: true,
      },
    });
    return user?.accountStatus === AccountStatus.ACTIVE && user.admin !== null;
  }
}
