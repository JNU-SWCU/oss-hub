import { Injectable } from '@nestjs/common';
import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';

export interface StudentDashboardMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionStatus:
    | 'NOT_SUBMITTED'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REJECTED';
}

export interface StudentDashboardItem {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly displayName: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestone | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeProgramId(value: string): boolean {
  return (
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

@Injectable()
export class StudentDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentDashboard(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardItem[]> {
    const applications = await this.prisma.application.findMany({
      where: {
        OR: [
          { teamId: null, applicant: { githubId: sessionGithubId } },
          {
            team: {
              OR: [
                { leader: { githubId: sessionGithubId } },
                {
                  members: {
                    some: { user: { githubId: sessionGithubId } },
                  },
                },
              ],
            },
          },
        ],
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        teamId: true,
        applicant: {
          select: {
            nickname: true,
            ...COMPATIBLE_PROFILE_NAME_SELECT,
          },
        },
        team: { select: { name: true } },
        program: {
          select: {
            id: true,
            name: true,
            milestones: {
              orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, dueAt: true },
            },
          },
        },
        submissions: { select: { milestoneId: true, status: true } },
      },
    });

    const items: StudentDashboardItem[] = [];
    for (const application of applications) {
      const applicationMode = application.teamId === null ? 'PERSONAL' : 'TEAM';
      const displayName =
        applicationMode === 'TEAM'
          ? application.team?.name
          : (resolveCompatibleProfileName(application.applicant) ??
            application.applicant.nickname);

      if (
        !isSafeProgramId(application.program.id) ||
        !isNonEmptyString(application.program.name) ||
        !isNonEmptyString(displayName)
      ) {
        continue;
      }

      const submissionStatuses = new Map(
        application.submissions.map((submission) => [
          submission.milestoneId,
          submission.status,
        ]),
      );
      const milestone =
        application.status === ApplicationStatus.APPROVED
          ? application.program.milestones.find(
              (candidate) =>
                submissionStatuses.get(candidate.id) !==
                SubmissionStatus.APPROVED,
            )
          : undefined;

      if (
        milestone &&
        (!isNonEmptyString(milestone.id) ||
          !isNonEmptyString(milestone.name) ||
          Number.isNaN(milestone.dueAt.getTime()))
      ) {
        continue;
      }

      const nextMilestone: StudentDashboardMilestone | null = milestone
        ? {
            id: milestone.id,
            name: milestone.name,
            dueAt: milestone.dueAt,
            submissionStatus:
              submissionStatuses.get(milestone.id) ?? 'NOT_SUBMITTED',
          }
        : null;

      items.push({
        applicationId: application.id,
        programId: application.program.id,
        programName: application.program.name,
        applicationMode,
        displayName,
        applicationStatus: application.status,
        nextMilestone,
        detailUrl:
          application.status === ApplicationStatus.SUBMITTED
            ? `/programs/${encodeURIComponent(application.program.id)}/apply`
            : `/programs/${encodeURIComponent(application.program.id)}`,
        checklistUrl: `/programs/${encodeURIComponent(application.program.id)}/submissions`,
      });
    }

    return items;
  }
}
