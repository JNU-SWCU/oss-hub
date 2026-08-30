import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  MilestoneDocumentKind,
  type MilestoneSubmissionType,
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
  submissionType: true,
} as const;

const dashboardSubmissionSelect = {
  applicationId: true,
  milestoneId: true,
  status: true,
  application: { select: { programId: true } },
  milestone: { select: { programId: true } },
} as const satisfies Prisma.SubmissionSelect;

/**
 * 서류 축의 **명부** — 이 프로그램들의 필수 서류 항목이 어느 마일스톤에 몇 개 달렸는가.
 *
 * 제출 행만으로는 「필수 서류가 있는데 아무도 안 냈다」를 알 수 없어서 명부를 따로 읽는다.
 */
const dashboardMilestoneDocumentSelect = {
  id: true,
  milestoneId: true,
  milestone: { select: { programId: true } },
} as const satisfies Prisma.MilestoneDocumentSelect;

const dashboardDocumentSubmissionSelect = {
  applicationId: true,
  milestoneDocumentId: true,
  status: true,
  application: { select: { programId: true } },
  milestoneDocument: {
    select: { milestoneId: true, milestone: { select: { programId: true } } },
  },
} as const satisfies Prisma.MilestoneDocumentSubmissionSelect;

export type DashboardApplicationRow = Prisma.ApplicationGetPayload<{
  select: typeof dashboardApplicationSelect;
}>;

export type DashboardMilestoneRow = Prisma.MilestoneGetPayload<{
  select: typeof dashboardMilestoneSelect;
}>;

export type DashboardSubmissionRow = Prisma.SubmissionGetPayload<{
  select: typeof dashboardSubmissionSelect;
}>;

export type DashboardMilestoneDocumentRow = Prisma.MilestoneDocumentGetPayload<{
  select: typeof dashboardMilestoneDocumentSelect;
}>;

export type DashboardDocumentSubmissionRow =
  Prisma.MilestoneDocumentSubmissionGetPayload<{
    select: typeof dashboardDocumentSubmissionSelect;
  }>;

export interface SubmissionDashboardSummaryDataSource {
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
  readonly submissionType: MilestoneSubmissionType | null;
}

export interface SubmissionDashboardSubmissionRecord {
  readonly applicationId: string;
  readonly applicationProgramId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}

/** 필수 서류 항목 하나. `milestoneProgramId` 는 제출 행과 같은 프로그램 대조를 위해 싣는다. */
export interface SubmissionDashboardMilestoneDocumentRecord {
  readonly id: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
}

export interface SubmissionDashboardDocumentSubmissionRecord {
  readonly applicationId: string;
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
    const [
      applications,
      milestones,
      submissions,
      milestoneDocuments,
      documentSubmissions,
    ] = await Promise.all([
      this.prisma.application.findMany({
        where: { programId: programFilter, status: ApplicationStatus.APPROVED },
        select: dashboardApplicationSelect,
      }),
      this.prisma.milestone.findMany({
        where: { programId: programFilter },
        select: dashboardMilestoneSelect,
      }),
      this.prisma.submission.findMany({
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
      // ⚠ 필수 서류만 — 선택 서류가 섞이면 안 낸 선택 서류가 칸을 미제출로 잡아 둔다.
      this.prisma.milestoneDocument.findMany({
        where: {
          required: true,
          kind: MilestoneDocumentKind.DOCUMENT,
          milestone: { is: { programId: programFilter } },
        },
        select: dashboardMilestoneDocumentSelect,
      }),
      this.prisma.milestoneDocumentSubmission.findMany({
        where: {
          application: {
            is: {
              programId: programFilter,
              status: ApplicationStatus.APPROVED,
            },
          },
          milestoneDocument: {
            is: {
              required: true,
              milestone: { is: { programId: programFilter } },
            },
          },
        },
        select: dashboardDocumentSubmissionSelect,
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
      milestoneDocuments: milestoneDocuments.map((document) => ({
        id: document.id,
        milestoneId: document.milestoneId,
        milestoneProgramId: document.milestone.programId,
      })),
      documentSubmissions: documentSubmissions.map((submission) => ({
        applicationId: submission.applicationId,
        applicationProgramId: submission.application.programId,
        milestoneDocumentId: submission.milestoneDocumentId,
        milestoneId: submission.milestoneDocument.milestoneId,
        milestoneProgramId: submission.milestoneDocument.milestone.programId,
        status: submission.status,
      })),
    };
  }
}
