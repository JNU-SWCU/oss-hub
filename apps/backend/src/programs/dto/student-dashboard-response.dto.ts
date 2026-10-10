import type { StudentDashboardItem } from '../domain/student-dashboard';
import type {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';

export interface StudentDashboardMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionStatus:
    | 'NOT_SUBMITTED'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REJECTED';
  readonly requiredItemCount: number;
  readonly remainingItemCount: number;
}

export interface StudentDashboardItemResponseDto {
  readonly coverImageUrl: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;

  readonly teamName: string;

  readonly teamUrl: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestoneResponseDto | null;
  readonly progress: {
    readonly approvedCount: number;
    readonly inReviewCount: number;
    readonly totalCount: number;
  } | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
  readonly repository: {
    readonly repositoryName: string | null;
    readonly provisionStatus: 'NOT_STARTED' | RepositoryProvisionJobStatus;
    readonly invitationStatus: RepositoryInvitationStatus | null;
    readonly githubUrl: string | null;
  } | null;
}

export class StudentDashboardResponseDto {
  readonly items: readonly StudentDashboardItemResponseDto[];

  private constructor(items: readonly StudentDashboardItem[]) {
    this.items = items.map((item) => ({
      coverImageUrl: item.coverImageUrl ?? null,
      applicationId: item.applicationId,
      programId: item.programId,
      programName: item.programName,
      teamName: item.teamName,
      teamUrl: item.teamUrl,
      applicationStatus: item.applicationStatus,
      nextMilestone: item.nextMilestone
        ? {
            id: item.nextMilestone.id,
            name: item.nextMilestone.name,
            dueAt: item.nextMilestone.dueAt.toISOString(),
            submissionStatus: item.nextMilestone.submissionStatus,
            requiredItemCount: item.nextMilestone.requiredItemCount,
            remainingItemCount: item.nextMilestone.remainingItemCount,
          }
        : null,
      progress: item.progress,
      detailUrl: item.detailUrl,
      checklistUrl: item.checklistUrl,
      repository: item.repository,
    }));
  }

  static from(
    items: readonly StudentDashboardItem[],
  ): StudentDashboardResponseDto {
    return new StudentDashboardResponseDto(items);
  }
}
