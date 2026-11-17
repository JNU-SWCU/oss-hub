import type { AuthorityLabel } from '../../users/authority-label.types';
import type {
  ProgramOverviewRequirement,
  ProgramOverviewScheduleMilestone,
  ProgramOverviewView,
} from '../program-overview.service';

export class ScheduleMilestoneResponseDto {
  declare readonly label: string;
  declare readonly dueAt: string;

  static from(
    milestone: ProgramOverviewScheduleMilestone,
  ): ScheduleMilestoneResponseDto {
    return { label: milestone.label, dueAt: milestone.dueAt.toISOString() };
  }
}

export class RequirementSummaryResponseDto {
  declare readonly milestoneId: string;
  declare readonly title: string;
  declare readonly completed: number;
  declare readonly total: number;

  static from(
    entry: ProgramOverviewRequirement,
  ): RequirementSummaryResponseDto {
    return {
      milestoneId: entry.milestoneId,
      title: entry.title,
      completed: entry.completed,
      total: entry.total,
    };
  }
}

export class ProgramOverviewResponseDto {
  declare readonly programId: string;
  declare readonly name: string;
  declare readonly trackType: string | null;
  declare readonly boardPostCount: number;

  declare readonly participantCount: number;
  declare readonly teamCount: number;
  declare readonly connectedRepositoryCount: number;
  declare readonly scheduleMilestones: ScheduleMilestoneResponseDto[];

  declare readonly viewerRole: AuthorityLabel | null;

  declare readonly viewerDocumentsCompleted: number | null;

  declare readonly viewerDocumentsTotal: number | null;

  declare readonly fullySubmittedParticipantCount: number | null;

  declare readonly requirements: RequirementSummaryResponseDto[];

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return {
      programId: view.programId,
      name: view.name,
      trackType: view.trackType,
      boardPostCount: view.boardPostCount,
      participantCount: view.participantCount,
      teamCount: view.teamCount,
      connectedRepositoryCount: view.connectedRepositoryCount,
      scheduleMilestones: view.scheduleMilestones.map((milestone) =>
        ScheduleMilestoneResponseDto.from(milestone),
      ),
      viewerRole: view.viewer.role,
      viewerDocumentsCompleted: view.viewer.myDocumentsCompleted,
      viewerDocumentsTotal: view.viewer.myDocumentsTotal,
      fullySubmittedParticipantCount:
        view.viewer.fullySubmittedParticipantCount,
      requirements: view.viewer.requirements.map((entry) =>
        RequirementSummaryResponseDto.from(entry),
      ),
    };
  }
}
