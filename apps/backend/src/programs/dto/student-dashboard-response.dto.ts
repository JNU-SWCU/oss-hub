import type { StudentDashboardItem } from '../service/student-dashboard.service';
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
}

export interface StudentDashboardItemResponseDto {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly displayName: string;
  readonly applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly nextMilestone: StudentDashboardMilestoneResponseDto | null;
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
      applicationId: item.applicationId,
      programId: item.programId,
      programName: item.programName,
      applicationMode: item.applicationMode,
      displayName: item.displayName,
      applicationStatus: item.applicationStatus,
      nextMilestone: item.nextMilestone
        ? {
            id: item.nextMilestone.id,
            name: item.nextMilestone.name,
            dueAt: item.nextMilestone.dueAt.toISOString(),
            submissionStatus: item.nextMilestone.submissionStatus,
          }
        : null,
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
