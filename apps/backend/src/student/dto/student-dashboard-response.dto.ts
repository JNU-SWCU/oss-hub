import type {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { StudentDashboardItem } from '../student-dashboard.service';

export class StudentDashboardMilestoneResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly dueAt: string;
  declare readonly lateSubmissionDueAt: string | null;
  declare readonly submissionStatus:
    | 'NOT_SUBMITTED'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REJECTED';
  declare readonly requiredItemCount: number;
  declare readonly remainingItemCount: number;

  static from(
    milestone: NonNullable<StudentDashboardItem['nextMilestone']>,
  ): StudentDashboardMilestoneResponseDto {
    return {
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
      lateSubmissionDueAt: milestone.lateSubmissionDueAt?.toISOString() ?? null,
      submissionStatus: milestone.submissionStatus,
      requiredItemCount: milestone.requiredItemCount,
      remainingItemCount: milestone.remainingItemCount,
    };
  }
}

export class StudentDashboardItemResponseDto {
  declare readonly coverImageUrl: string | null;
  declare readonly applicationId: string;
  declare readonly programId: string;
  declare readonly programName: string;

  declare readonly teamName: string;

  declare readonly teamUrl: string;
  declare readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  declare readonly nextMilestone: StudentDashboardMilestoneResponseDto | null;
  declare readonly progress: {
    readonly approvedCount: number;
    readonly inReviewCount: number;
    readonly totalCount: number;
  } | null;
  declare readonly detailUrl: string;
  declare readonly checklistUrl: string;
  declare readonly repository: {
    readonly repositoryName: string | null;
    readonly provisionStatus: 'NOT_STARTED' | RepositoryProvisionJobStatus;
    readonly invitationStatus: RepositoryInvitationStatus | null;
    readonly githubUrl: string | null;
  } | null;

  static from(item: StudentDashboardItem): StudentDashboardItemResponseDto {
    return {
      coverImageUrl: item.coverImageUrl ?? null,
      applicationId: item.applicationId,
      programId: item.programId,
      programName: item.programName,
      teamName: item.teamName,
      teamUrl: item.teamUrl,
      applicationStatus: item.applicationStatus,
      nextMilestone: item.nextMilestone
        ? StudentDashboardMilestoneResponseDto.from(item.nextMilestone)
        : null,
      progress: item.progress,
      detailUrl: item.detailUrl,
      checklistUrl: item.checklistUrl,
      repository: item.repository,
    };
  }
}

export class StudentDashboardResponseDto {
  declare readonly items: readonly StudentDashboardItemResponseDto[];

  static from(
    items: readonly StudentDashboardItem[],
  ): StudentDashboardResponseDto {
    return {
      items: items.map((item) => StudentDashboardItemResponseDto.from(item)),
    };
  }
}
