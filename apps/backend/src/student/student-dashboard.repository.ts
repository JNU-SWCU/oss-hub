import { Injectable } from '@nestjs/common';
import { type ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { SubmissionCompletionTargetRow } from '../programs/submission-completion.config';
import { PlatformRepository } from '../platform/platform.repository';
interface StudentDashboardMilestoneRow {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly documents: readonly {
    readonly id: string;
    readonly graceDueAt: Date | null;
  }[];
}
export interface StudentDashboardApplicationRow {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly name: string;
  readonly program: {
    readonly id: string;
    readonly name: string;
    readonly cover?: {
      readonly id: string;
      readonly imageUrl?: string | null;
    } | null;
    readonly milestones: readonly StudentDashboardMilestoneRow[];
  };
  readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
}
const studentDashboardApplicationSelect = {
  id: true,
  status: true,
  name: true,
  program: {
    select: {
      cover: { select: { id: true, imageUrl: true } },
      id: true,
      name: true,
      milestones: {
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          dueAt: true,
          documents: {
            where: { required: true },
            select: { id: true, graceDueAt: true },
          },
        },
      },
    },
  },
  milestoneDocumentSubmissions: {
    select: {
      status: true,
      milestoneDocument: { select: { id: true, milestoneId: true } },
    } satisfies Prisma.MilestoneDocumentSubmissionSelect,
  },
} satisfies Prisma.TeamSelect;
@Injectable()
export class StudentDashboardRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async findParticipatingApplications(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardApplicationRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return [];

    return this.prisma.team.findMany({
      where: this.platformRepository.programApplicationParticipantWhere(
        user.id,
      ),
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      select: studentDashboardApplicationSelect,
    });
  }
}
