import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  Prisma,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
const dashboardApplicationSelect = {
  id: true,
  programId: true,
} satisfies Prisma.TeamSelect;
const dashboardMilestoneSelect = {
  id: true,
  programId: true,
} satisfies Prisma.MilestoneSelect;
const dashboardMilestoneDocumentSelect = {
  id: true,
  milestoneId: true,
  milestone: { select: { programId: true } },
} satisfies Prisma.MilestoneDocumentSelect;
const dashboardDocumentSubmissionSelect = {
  teamId: true,
  milestoneDocumentId: true,
  status: true,
  team: { select: { programId: true } },
  milestoneDocument: {
    select: {
      milestoneId: true,
      milestone: { select: { programId: true } },
    },
  },
} satisfies Prisma.MilestoneDocumentSubmissionSelect;
export type DashboardApplicationRow = Prisma.TeamGetPayload<{
  select: typeof dashboardApplicationSelect;
}>;
export type DashboardMilestoneRow = Prisma.MilestoneGetPayload<{
  select: typeof dashboardMilestoneSelect;
}>;
export type DashboardMilestoneDocumentRow = Prisma.MilestoneDocumentGetPayload<{
  select: typeof dashboardMilestoneDocumentSelect;
}>;
export type DashboardDocumentSubmissionRow =
  Prisma.MilestoneDocumentSubmissionGetPayload<{
    select: typeof dashboardDocumentSubmissionSelect;
  }>;
export interface SubmissionDashboardSummaryDataSource {
  readonly team: {
    findMany(args: {
      readonly where: Prisma.TeamWhereInput;
      readonly select: typeof dashboardApplicationSelect;
    }): Promise<readonly DashboardApplicationRow[]>;
  };
  readonly milestone: {
    findMany(args: {
      readonly where: Prisma.MilestoneWhereInput;
      readonly select: typeof dashboardMilestoneSelect;
    }): Promise<readonly DashboardMilestoneRow[]>;
  };
  readonly milestoneDocument: {
    findMany(args: {
      readonly where: Prisma.MilestoneDocumentWhereInput;
      readonly select: typeof dashboardMilestoneDocumentSelect;
    }): Promise<readonly DashboardMilestoneDocumentRow[]>;
  };
  readonly milestoneDocumentSubmission: {
    findMany(args: {
      readonly where: Prisma.MilestoneDocumentSubmissionWhereInput;
      readonly select: typeof dashboardDocumentSubmissionSelect;
    }): Promise<readonly DashboardDocumentSubmissionRow[]>;
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
interface SubmissionDashboardSubmissionRecord {
  readonly teamId: string;
  readonly applicationProgramId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}
export interface SubmissionDashboardMilestoneDocumentRecord {
  readonly id: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
}
export interface SubmissionDashboardDocumentSubmissionRecord {
  readonly teamId: string;
  readonly applicationProgramId: string;
  readonly milestoneDocumentId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}
export interface SubmissionDashboardSummaryRecords {
  readonly applications: readonly SubmissionDashboardApplicationRecord[];
  readonly milestones: readonly SubmissionDashboardMilestoneRecord[];
  readonly submissions: readonly SubmissionDashboardSubmissionRecord[];
  readonly milestoneDocuments: readonly SubmissionDashboardMilestoneDocumentRecord[];
  readonly documentSubmissions: readonly SubmissionDashboardDocumentSubmissionRecord[];
}
export interface SubmissionDashboardSummaryRepositoryPort {
  listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords>;
}
@Injectable()
export class SubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: SubmissionDashboardSummaryDataSource,
  ) {}
  async listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords> {
    if (programIds.length === 0) {
      return {
        applications: [],
        milestones: [],
        submissions: [],
        milestoneDocuments: [],
        documentSubmissions: [],
      };
    }
    const programFilter = { in: [...programIds] };
    const [applications, milestones, milestoneDocuments, targetSubmissions] =
      await Promise.all([
        this.prisma.team.findMany({
          where: {
            programId: programFilter,
            status: ApplicationStatus.APPROVED,
          },
          select: dashboardApplicationSelect,
        }),
        this.prisma.milestone.findMany({
          where: { programId: programFilter },
          select: dashboardMilestoneSelect,
        }),
        this.prisma.milestoneDocument.findMany({
          where: {
            required: true,
            milestone: { is: { programId: programFilter } },
          },
          select: dashboardMilestoneDocumentSelect,
        }),
        this.prisma.milestoneDocumentSubmission.findMany({
          where: {
            team: {
              is: {
                programId: programFilter,
                status: ApplicationStatus.APPROVED,
              },
            },
            milestoneDocument: {
              is: {
                milestone: { is: { programId: programFilter } },
                required: true,
              },
            },
          },
          select: dashboardDocumentSubmissionSelect,
        }),
      ]);
    const submissions: SubmissionDashboardSubmissionRecord[] = [];
    const documentSubmissions: SubmissionDashboardDocumentSubmissionRecord[] =
      [];
    for (const submission of targetSubmissions) {
      const { milestoneDocument } = submission;
      documentSubmissions.push({
        teamId: submission.teamId,
        applicationProgramId: submission.team.programId,
        milestoneDocumentId: submission.milestoneDocumentId,
        milestoneId: milestoneDocument.milestoneId,
        milestoneProgramId: milestoneDocument.milestone.programId,
        status: submission.status,
      });
    }
    return {
      applications,
      milestones,
      submissions,
      milestoneDocuments: milestoneDocuments.map((document) => ({
        id: document.id,
        milestoneId: document.milestoneId,
        milestoneProgramId: document.milestone.programId,
      })),
      documentSubmissions,
    };
  }
}
