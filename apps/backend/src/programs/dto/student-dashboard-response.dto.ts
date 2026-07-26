import type { StudentDashboardItem } from '../student-dashboard.service';

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
    }));
  }

  static from(
    items: readonly StudentDashboardItem[],
  ): StudentDashboardResponseDto {
    return new StudentDashboardResponseDto(items);
  }
}
