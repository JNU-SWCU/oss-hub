import type {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';

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

export interface StudentDashboardProgress {
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
