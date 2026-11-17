import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { READ_CAP } from '../platform/bounded-read.config';
import { Injectable } from '@nestjs/common';
import { type ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { SubmissionCompletionTargetRow } from '../programs/submission-completion.config';
import { PlatformRepository } from '../platform/platform.repository';
interface StudentDashboardMilestoneRow {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly requirements: readonly {
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
    readonly coverFileId?: string | null;
    readonly coverImageUrl?: string | null;
    readonly milestones: readonly StudentDashboardMilestoneRow[];
  };
  readonly submissions: readonly SubmissionCompletionTargetRow[];
}
const studentDashboardApplicationSelect = {
  id: true,
  status: true,
  name: true,
  program: {
    select: {
      coverFileId: true,
      coverImageUrl: true,
      id: true,
      name: true,
      milestones: {
        take: READ_CAP.milestonesPerProgram + 1,
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          dueAt: true,
          requirements: {
            take: READ_CAP.requirementsPerMilestone + 1,
            where: { required: true },
            select: { id: true, graceDueAt: true },
          },
        },
      },
    },
  },
  submissions: {
    take: READ_CAP.requirementsPerProgram + 1,
    select: {
      status: true,
      requirement: { select: { id: true, milestoneId: true } },
    } satisfies Prisma.SubmissionSelect,
  },
} satisfies Prisma.TeamSelect;
@Injectable()
export class StudentDashboardRepository {
  private readonly boundedReads = new BoundedReadRepository();

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

    return this.boundedReads.readCapped(
      READ_CAP.teamsPerUser,
      'Team per user',
      (take) =>
        this.prisma.team
          .findMany({
            take,
            where: this.platformRepository.programApplicationParticipantWhere(
              user.id,
            ),
            orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
            select: studentDashboardApplicationSelect,
          })
          .then((result) =>
            this.boundedReads.assertNestedWithin(
              result,
              {
                program: {
                  nested: {
                    milestones: {
                      cap: READ_CAP.milestonesPerProgram,
                      nested: {
                        requirements: READ_CAP.requirementsPerMilestone,
                      },
                    },
                  },
                },
                submissions: READ_CAP.requirementsPerProgram,
              },
              'Team.findMany',
            ),
          ),
    );
  }
}
