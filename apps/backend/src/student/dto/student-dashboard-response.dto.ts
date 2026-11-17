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

class StudentDashboardProgressResponseDto {
  declare readonly approvedCount: number;
  declare readonly inReviewCount: number;
  declare readonly totalCount: number;

  static from(
    progress: NonNullable<StudentDashboardItem['progress']>,
  ): StudentDashboardProgressResponseDto {
    return {
      approvedCount: progress.approvedCount,
      inReviewCount: progress.inReviewCount,
      totalCount: progress.totalCount,
    };
  }
}

class StudentDashboardRepositoryResponseDto {
  declare readonly repositoryName: string | null;
  declare readonly provisionStatus:
    'NOT_STARTED' | RepositoryProvisionJobStatus;
  declare readonly invitationStatus: RepositoryInvitationStatus | null;
  declare readonly githubUrl: string | null;

  static from(
    repository: NonNullable<StudentDashboardItem['repository']>,
  ): StudentDashboardRepositoryResponseDto {
    return {
      repositoryName: repository.repositoryName,
      provisionStatus: repository.provisionStatus,
      invitationStatus: repository.invitationStatus,
      githubUrl: repository.githubUrl,
    };
  }
}

export class StudentDashboardItemResponseDto {
  declare readonly coverImageUrl: string | null;
  declare readonly teamId: string;
  declare readonly programId: string;
  declare readonly programName: string;

  declare readonly teamName: string;

  declare readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  declare readonly nextMilestone: StudentDashboardMilestoneResponseDto | null;
  declare readonly progress: StudentDashboardProgressResponseDto | null;
  declare readonly detailUrl: string;
  declare readonly repository: StudentDashboardRepositoryResponseDto | null;

  static from(item: StudentDashboardItem): StudentDashboardItemResponseDto {
    return {
      coverImageUrl: item.coverImageUrl ?? null,
      teamId: item.teamId,
      programId: item.programId,
      programName: item.programName,
      teamName: item.teamName,
      applicationStatus: item.applicationStatus,
      nextMilestone: item.nextMilestone
        ? StudentDashboardMilestoneResponseDto.from(item.nextMilestone)
        : null,
      progress: item.progress
        ? StudentDashboardProgressResponseDto.from(item.progress)
        : null,
      detailUrl: item.detailUrl,
      repository: item.repository
        ? StudentDashboardRepositoryResponseDto.from(item.repository)
        : null,
    };
  }
}

export class StudentDashboardResponseDto {
  declare readonly items: StudentDashboardItemResponseDto[];

  static from(
    items: readonly StudentDashboardItem[],
  ): StudentDashboardResponseDto {
    return {
      items: items.map((item) => StudentDashboardItemResponseDto.from(item)),
    };
  }
}
