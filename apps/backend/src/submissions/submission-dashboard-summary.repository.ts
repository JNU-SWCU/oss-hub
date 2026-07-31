import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  Prisma,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const dashboardApplicationSelect = {
  id: true,
  programId: true,
} as const;

const dashboardMilestoneSelect = {
  id: true,
  programId: true,
} as const;

const dashboardSubmissionSelect = {
  applicationId: true,
  milestoneId: true,
  status: true,
  application: { select: { programId: true } },
  milestone: { select: { programId: true } },
} as const satisfies Prisma.SubmissionSelect;

export type DashboardApplicationRow = Prisma.ApplicationGetPayload<{
  select: typeof dashboardApplicationSelect;
}>;

export type DashboardMilestoneRow = Prisma.MilestoneGetPayload<{
  select: typeof dashboardMilestoneSelect;
}>;

export type DashboardSubmissionRow = Prisma.SubmissionGetPayload<{
  select: typeof dashboardSubmissionSelect;
}>;

export interface SubmissionDashboardSummaryDatabase {
  readonly application: {
    findMany(args: {
      readonly where: Prisma.ApplicationWhereInput;
      readonly select: typeof dashboardApplicationSelect;
    }): Promise<readonly DashboardApplicationRow[]>;
  };
  readonly milestone: {
    findMany(args: {
      readonly where: Prisma.MilestoneWhereInput;
      readonly select: typeof dashboardMilestoneSelect;
    }): Promise<readonly DashboardMilestoneRow[]>;
  };
  readonly submission: {
    findMany(args: {
      readonly where: Prisma.SubmissionWhereInput;
      readonly select: typeof dashboardSubmissionSelect;
    }): Promise<readonly DashboardSubmissionRow[]>;
  };
}

export interface SubmissionDashboardApplicationRecord {
  readonly id: string;
  readonly programId: string;
}

export interface SubmissionDashboardMilestoneRecord {
  readonly id: string;
  readonly programId: string;
}

export interface SubmissionDashboardSubmissionRecord {
  readonly applicationId: string;
  readonly applicationProgramId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}

export interface SubmissionDashboardSummaryRecords {
  readonly applications: readonly SubmissionDashboardApplicationRecord[];
  readonly milestones: readonly SubmissionDashboardMilestoneRecord[];
  readonly submissions: readonly SubmissionDashboardSubmissionRecord[];
}

export interface SubmissionDashboardSummaryRepositoryPort {
  listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords>;
}

export class PrismaSubmissionDashboardSummaryStore implements SubmissionDashboardSummaryRepositoryPort {
  constructor(private readonly database: SubmissionDashboardSummaryDatabase) {}

  async listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords> {
    if (programIds.length === 0) {
      return { applications: [], milestones: [], submissions: [] };
    }

    const programFilter = { in: [...programIds] };
    const [applications, milestones, submissions] = await Promise.all([
      this.database.application.findMany({
        where: { programId: programFilter, status: ApplicationStatus.APPROVED },
        select: dashboardApplicationSelect,
      }),
      this.database.milestone.findMany({
        where: { programId: programFilter },
        select: dashboardMilestoneSelect,
      }),
      this.database.submission.findMany({
        where: {
          application: {
            is: {
              programId: programFilter,
              status: ApplicationStatus.APPROVED,
            },
          },
          milestone: {
            is: {
              programId: programFilter,
            },
          },
        },
        select: dashboardSubmissionSelect,
      }),
    ]);

    return {
      applications,
      milestones,
      submissions: submissions.map((submission) => ({
        applicationId: submission.applicationId,
        applicationProgramId: submission.application.programId,
        milestoneId: submission.milestoneId,
        milestoneProgramId: submission.milestone.programId,
        status: submission.status,
      })),
    };
  }
}

@Injectable()
export class SubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  private readonly store: PrismaSubmissionDashboardSummaryStore;

  constructor(private readonly prisma: PrismaService) {
    this.store = new PrismaSubmissionDashboardSummaryStore({
      application: {
        findMany: (args) =>
          prisma.application.findMany({
            where: args.where,
            select: dashboardApplicationSelect,
          }),
      },
      milestone: {
        findMany: (args) =>
          prisma.milestone.findMany({
            where: args.where,
            select: dashboardMilestoneSelect,
          }),
      },
      submission: {
        findMany: (args) =>
          prisma.submission.findMany({
            where: args.where,
            select: dashboardSubmissionSelect,
          }),
      },
    });
  }

  listRecords(programIds: readonly string[]) {
    return this.store.listRecords(programIds);
  }
}
