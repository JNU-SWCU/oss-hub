import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  type Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DeadlineProgramSource,
  DeadlineRecipientSource,
  DeadlineWindow,
} from './deadline-digest-eligibility';

export type DigestNotificationStatus = 'SENT' | 'FAILED';

/** 교직원 요약 메일 수신자. `Program`에 담당 교직원 관계가 없어 전역 STAFF/ADMIN이다. */
export type NotifiableStaffRecipient = {
  readonly id: string;
  readonly notificationEmail: string;
};

export interface DeadlineDigestRepositoryPort {
  findAutomaticProgramIds(window: DeadlineWindow): Promise<readonly string[]>;
  findDeadlineProgram(programId: string): Promise<DeadlineProgramSource | null>;
  findActiveStaffOrAdmin(githubId: bigint): Promise<boolean>;
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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAutomaticProgramIds(
    window: DeadlineWindow,
  ): Promise<readonly string[]> {
    const programs = await this.prisma.program.findMany({
      where: {
        notifyOnDeadline: true,
        milestones: {
          some: {
            dueAt: { gte: window.from, lte: window.to },
            documents: { some: { required: true } },
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
      where: { id: programId },
      select: {
        id: true,
        name: true,
        notifyOnDeadline: true,
        milestones: {
          select: {
            id: true,
            name: true,
            dueAt: true,
            documents: {
              select: { id: true, required: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        },
        applications: {
          where: { status: ApplicationStatus.APPROVED },
          select: {
            id: true,
            applicant: { select: deadlineRecipientSelect },
            team: {
              select: {
                members: {
                  select: { user: { select: deadlineRecipientSelect } },
                  orderBy: { userId: 'asc' },
                },
              },
            },
            milestoneDocumentSubmissions: {
              select: { milestoneDocumentId: true },
              orderBy: { milestoneDocumentId: 'asc' },
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
      applications: program.applications.map((application) => ({
        id: application.id,
        applicant: application.applicant,
        members: application.team.members.map(
          (member): DeadlineRecipientSource => member.user,
        ),
        submittedDocumentIds: application.milestoneDocumentSubmissions.map(
          (submission) => submission.milestoneDocumentId,
        ),
      })),
    };
  }

  async findActiveStaffOrAdmin(githubId: bigint): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
    return (
      user?.accountStatus === AccountStatus.ACTIVE &&
      (user.role === Role.STAFF || user.role === Role.ADMIN)
    );
  }

  /**
   * `findActiveStaffOrAdmin`은 호출자 권한 판정용 boolean이라 재사용하지 않는다.
   * 여기서는 실제 메일이 나갈 수 있는 교직원만 고른다.
   */
  async findNotifiableStaff(): Promise<readonly NotifiableStaffRecipient[]> {
    const staff = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.STAFF, Role.ADMIN] },
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
      select: { role: true, accountStatus: true },
    });
    return (
      user?.role === Role.ADMIN && user.accountStatus === AccountStatus.ACTIVE
    );
  }
}
