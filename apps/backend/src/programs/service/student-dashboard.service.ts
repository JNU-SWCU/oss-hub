import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import {
  collectAxisStatuses,
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
  type MilestoneCompletionStatus,
} from '../../milestone-documents/domain/milestone-completion';
import { programCoverImageUrl } from '../program-cover';
import { RepositoriesReadService } from '../../github/service/repositories-read.service';
import { projectSubmissionCompletionTargets } from '../../submissions/domain/submission-completion-projection';
import {
  StudentDashboardReadRepository,
  type StudentDashboardApplicationRow,
} from '../repository/student-dashboard-read.repository';

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
  readonly requiredItemCount: number;
  readonly remainingItemCount: number;
}

interface StudentDashboardProgress {
  readonly approvedCount: number;
  readonly inReviewCount: number;
  readonly totalCount: number;
}

export interface StudentDashboardItem {
  readonly coverImageUrl?: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly teamUrl: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestone | null;
  readonly progress: StudentDashboardProgress | null;
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

function detailUrlFor(status: ApplicationStatus, programId: string): string {
  const program = `/programs/${encodeURIComponent(programId)}`;
  return status === ApplicationStatus.APPROVED ? program : `${program}/apply`;
}

function teamUrlFor(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/my-team`;
}

interface MilestoneStatuses {
  readonly status: MilestoneCompletionStatus;
  readonly itemStatuses: readonly MilestoneCompletionStatus[];
}

function milestoneStatusesFor(
  application: StudentDashboardApplicationRow,
): ReadonlyMap<string, MilestoneStatuses> {
  const { submissions, documentSubmissions } =
    projectSubmissionCompletionTargets(
      application.milestoneDocumentSubmissions,
    );
  const legacyStatusByMilestone = new Map(
    submissions.map((submission) => [
      submission.milestoneId,
      submission.status,
    ]),
  );
  const statusByDocument = new Map(
    documentSubmissions.map((submission) => [
      submission.milestoneDocumentId,
      submission.status,
    ]),
  );
  return new Map(
    application.program.milestones.map((milestone) => {
      const input = {
        submissionAxisInUse: milestone.submissionType !== null,
        requiredDocumentStatuses: milestone.documents.map(
          (document) => statusByDocument.get(document.id) ?? null,
        ),
        submissionStatus: legacyStatusByMilestone.get(milestone.id) ?? null,
      };
      return [
        milestone.id,
        {
          status: milestoneCompletionStatus(input),
          itemStatuses: collectAxisStatuses(input),
        },
      ];
    }),
  );
}

function progressOf(
  milestoneStatuses: ReadonlyMap<string, MilestoneStatuses>,
): StudentDashboardProgress {
  const required = [...milestoneStatuses.values()].filter(
    (milestone) => milestone.itemStatuses.length > 0,
  );
  return {
    approvedCount: required.filter(
      (milestone) => milestone.status === SubmissionStatus.APPROVED,
    ).length,
    inReviewCount: required.filter(
      (milestone) => milestone.status === SubmissionStatus.SUBMITTED,
    ).length,
    totalCount: required.length,
  };
}

@Injectable()
export class StudentDashboardService {
  constructor(
    private readonly repository: StudentDashboardReadRepository,
    @Inject(RepositoriesReadService)
    private readonly repositories: Pick<
      RepositoriesReadService,
      'getMyRepositories'
    >,
  ) {}

  async getStudentDashboard(
    sessionGithubId: bigint,
  ): Promise<readonly StudentDashboardItem[]> {
    const [applications, projectedRepositories] = await Promise.all([
      this.repository.findParticipatingApplications(sessionGithubId),
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
      if (
        !isSafeProgramId(application.program.id) ||
        !isNonEmptyString(application.program.name) ||
        !isNonEmptyString(application.team.name)
      ) {
        continue;
      }

      const milestoneStatuses =
        application.status === ApplicationStatus.APPROVED
          ? milestoneStatusesFor(application)
          : null;
      const nextMilestone =
        milestoneStatuses === null
          ? null
          : this.nextMilestoneFor(application, milestoneStatuses);
      if (nextMilestone === 'invalid') continue;

      items.push({
        coverImageUrl: programCoverImageUrl(
          application.program.id,
          application.program.cover?.id,
          application.program.cover?.imageUrl,
        ),
        applicationId: application.id,
        programId: application.program.id,
        programName: application.program.name,
        teamName: application.team.name,
        teamUrl: teamUrlFor(application.program.id),
        applicationStatus: application.status,
        nextMilestone,
        progress:
          milestoneStatuses === null ? null : progressOf(milestoneStatuses),
        detailUrl: detailUrlFor(application.status, application.program.id),
        checklistUrl: `/programs/${encodeURIComponent(application.program.id)}/submissions`,
        repository: this.repositoryFor(application, repositoryByApplication),
      });
    }

    return items;
  }

  private nextMilestoneFor(
    application: StudentDashboardApplicationRow,
    milestoneStatuses: ReadonlyMap<string, MilestoneStatuses>,
  ): StudentDashboardMilestone | null | 'invalid' {
    const milestone = application.program.milestones.find((candidate) => {
      const statuses = milestoneStatuses.get(candidate.id);
      return (
        statuses !== undefined &&
        statuses.itemStatuses.length > 0 &&
        statuses.status !== SubmissionStatus.APPROVED
      );
    });
    if (milestone === undefined) return null;
    if (
      !isNonEmptyString(milestone.id) ||
      !isNonEmptyString(milestone.name) ||
      Number.isNaN(milestone.dueAt.getTime())
    ) {
      return 'invalid';
    }

    const statuses = milestoneStatuses.get(milestone.id);
    const itemStatuses = statuses?.itemStatuses ?? [];
    return {
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt,
      submissionStatus: statuses?.status ?? MILESTONE_NOT_SUBMITTED,
      requiredItemCount: itemStatuses.length,
      remainingItemCount: itemStatuses.filter(
        (status) =>
          status === MILESTONE_NOT_SUBMITTED ||
          status === SubmissionStatus.CHANGES_REQUESTED,
      ).length,
    };
  }

  private repositoryFor(
    application: StudentDashboardApplicationRow,
    repositoryByApplication: ReadonlyMap<
      string,
      Awaited<ReturnType<RepositoriesReadService['getMyRepositories']>>[number]
    >,
  ): StudentDashboardRepository | null {
    if (application.status !== ApplicationStatus.APPROVED) return null;

    const projectedRepository = repositoryByApplication.get(application.id);
    if (projectedRepository === undefined) {
      return {
        repositoryName: null,
        provisionStatus: 'NOT_STARTED',
        invitationStatus: null,
        githubUrl: null,
      };
    }

    const invitationStatus =
      projectedRepository.provisionStatus ===
        RepositoryProvisionJobStatus.SUCCEEDED &&
      projectedRepository.invitationStatus === null &&
      projectedRepository.connectionMode === RepositoryConnectionMode.NEW
        ? RepositoryInvitationStatus.FAILED_FINAL
        : projectedRepository.invitationStatus;

    return {
      repositoryName: projectedRepository.repositoryName,
      provisionStatus: projectedRepository.provisionStatus,
      invitationStatus,
      githubUrl: projectedRepository.githubUrl,
    };
  }
}
