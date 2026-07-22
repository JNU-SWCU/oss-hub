import { Injectable } from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ApplicationSubmissionSummaryResponseDto,
  ProgramDetailResponseDto,
  ViewerSubmissionStatusResponseDto,
} from './dto/program-detail.dto';
import { programDeadline } from './program-deadline';
import { PROGRAM_ERROR_CODES } from './program-error-code';
import type { ProgramViewer } from './program-viewer.service';

type SubmissionRecord = {
  readonly milestoneId: string;
  readonly status: SubmissionStatus;
};

const EMPTY_SUMMARY = {
  notSubmitted: 0,
  submitted: 0,
  approved: 0,
  changesRequested: 0,
  rejected: 0,
  total: 0,
} as const satisfies ApplicationSubmissionSummaryResponseDto;

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(
    programId: string,
    viewer: ProgramViewer,
    now: Date = new Date(),
  ): Promise<ProgramDetailResponseDto> {
    try {
      const program = await this.prisma.program.findUnique({
        where: { id: programId },
        select: {
          id: true,
          name: true,
          organizer: true,
          category: true,
          description: true,
          applicationStartAt: true,
          applicationEndAt: true,
          milestones: {
            orderBy: { dueAt: 'asc' },
            select: {
              id: true,
              name: true,
              dueAt: true,
              instructions: true,
              submissionType: true,
            },
          },
        },
      });
      if (!program) throw new DomainException(PROGRAM_ERROR_CODES.NOT_FOUND);

      const studentApplication =
        viewer.role === Role.STUDENT && viewer.userId
          ? await this.prisma.application.findFirst({
              where: {
                programId,
                OR: [
                  { applicantId: viewer.userId },
                  { team: { members: { some: { userId: viewer.userId } } } },
                ],
              },
              select: {
                id: true,
                status: true,
                submissions: { select: { milestoneId: true, status: true } },
              },
            })
          : null;
      const staffApplications =
        viewer.role === Role.STAFF || viewer.role === Role.ADMIN
          ? await this.prisma.application.findMany({
              where: { programId },
              select: {
                submissions: { select: { milestoneId: true, status: true } },
              },
            })
          : null;

      return {
        id: program.id,
        name: program.name,
        organizer: program.organizer,
        category: program.category,
        description: program.description,
        applicationPeriod: {
          startsAt: program.applicationStartAt.toISOString(),
          endsAt: program.applicationEndAt.toISOString(),
        },
        viewer: {
          role: viewer.role,
          applicationStatus: studentApplication?.status ?? null,
        },
        milestones: program.milestones.map((milestone) => {
          const deadline = programDeadline(milestone.dueAt, now);
          const submission = studentApplication?.submissions.find(
            (item) => item.milestoneId === milestone.id,
          );
          return {
            id: milestone.id,
            name: milestone.name,
            dueAt: milestone.dueAt.toISOString(),
            dDay: deadline.dDay,
            deadlineLabel: deadline.label,
            description: milestone.instructions,
            submissionType: milestone.submissionType,
            viewerSubmissionStatus: this.viewerSubmissionStatus(
              studentApplication?.id ?? null,
              submission ?? null,
            ),
            applicationSubmissionSummary: staffApplications
              ? this.summaryForMilestone(milestone.id, staffApplications)
              : null,
          };
        }),
      };
    } catch (error: unknown) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(PROGRAM_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }

  private viewerSubmissionStatus(
    applicationId: string | null,
    submission: SubmissionRecord | null,
  ): ViewerSubmissionStatusResponseDto {
    if (!applicationId) return null;
    return submission?.status ?? 'NOT_SUBMITTED';
  }

  private summaryForMilestone(
    milestoneId: string,
    applications: readonly {
      readonly submissions: readonly SubmissionRecord[];
    }[],
  ): ApplicationSubmissionSummaryResponseDto {
    const summary = { ...EMPTY_SUMMARY, total: applications.length };
    for (const application of applications) {
      const status = application.submissions.find(
        (submission) => submission.milestoneId === milestoneId,
      )?.status;
      if (!status) summary.notSubmitted += 1;
      else if (status === SubmissionStatus.SUBMITTED) summary.submitted += 1;
      else if (status === SubmissionStatus.APPROVED) summary.approved += 1;
      else if (status === SubmissionStatus.CHANGES_REQUESTED)
        summary.changesRequested += 1;
      else summary.rejected += 1;
    }
    return summary;
  }
}
