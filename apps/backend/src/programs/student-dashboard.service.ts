import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { RepositoriesService } from '../repositories/repositories.service';

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
  readonly repository: StudentDashboardRepository | null;
}

export interface StudentDashboardRepository {
  readonly repositoryName: string | null;
  readonly provisionStatus: 'NOT_STARTED' | RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly githubUrl: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RepositoriesService)
    private readonly repositories: Pick<
      RepositoriesService,
      'getMyRepositories'
    >,
  ) {}

  async getStudentDashboard(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardItem[]> {
    const [applications, projectedRepositories] = await Promise.all([
      this.prisma.application.findMany({
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
      }),
      this.repositories.getMyRepositories(sessionGithubId),
    ]);
    const repositoryByApplication = new Map(
      projectedRepositories.map((repository) => [
        repository.applicationId,
        repository,
      ]),
    );

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
      let repository: StudentDashboardRepository | null = null;
      if (application.status === ApplicationStatus.APPROVED) {
        const projectedRepository = repositoryByApplication.get(application.id);
        if (projectedRepository === undefined) {
          repository = {
            repositoryName: null,
            provisionStatus: 'NOT_STARTED',
            invitationStatus: null,
            githubUrl: null,
          };
        } else {
          repository = {
            repositoryName: projectedRepository.repositoryName,
            provisionStatus: projectedRepository.provisionStatus,
            invitationStatus: projectedRepository.invitationStatus,
            githubUrl: projectedRepository.githubUrl,
          };
        }
      }

      items.push({
        applicationId: application.id,
        programId: application.program.id,
        programName: application.program.name,
        applicationMode,
        displayName,
        applicationStatus: application.status,
        nextMilestone,
        detailUrl: `/programs/${encodeURIComponent(application.program.id)}`,
        checklistUrl: `/programs/${encodeURIComponent(application.program.id)}/submissions`,
        repository,
      });
    }

    return items;
  }
}
