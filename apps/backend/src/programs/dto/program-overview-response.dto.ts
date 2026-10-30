import { IsIn, IsOptional } from 'class-validator';
import type { AuthorityLabel } from '../../users/authority-label.policy';
import {
  ProgramOverviewMilestoneDocument,
  ProgramOverviewRemainingMilestone,
  ProgramOverviewView,
} from '../programs.types';

export class RemainingMilestoneResponseDto {
  declare readonly label: string;
  declare readonly dueAt: string;

  static from(
    milestone: ProgramOverviewRemainingMilestone,
  ): RemainingMilestoneResponseDto {
    return { label: milestone.label, dueAt: milestone.dueAt.toISOString() };
  }
}

export class MilestoneDocumentSummaryResponseDto {
  declare readonly milestoneId: string;
  declare readonly title: string;
  declare readonly completed: number;
  declare readonly total: number;

  static from(
    entry: ProgramOverviewMilestoneDocument,
  ): MilestoneDocumentSummaryResponseDto {
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
  declare readonly lifecycle: string;
  declare readonly milestoneCount: number;
  declare readonly boardPostCount: number;

  declare readonly participantCount: number;
  declare readonly teamCount: number;
  declare readonly connectedRepositoryCount: number;
  declare readonly remainingMilestones: RemainingMilestoneResponseDto[];

  declare readonly viewerRole: AuthorityLabel | null;

  declare readonly viewerDocumentsCompleted: number | null;

  declare readonly viewerDocumentsTotal: number | null;

  declare readonly fullySubmittedParticipantCount: number | null;

  declare readonly milestoneDocuments: MilestoneDocumentSummaryResponseDto[];

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return {
      programId: view.programId,
      name: view.name,
      trackType: view.trackType,
      lifecycle: view.lifecycle,
      milestoneCount: view.milestoneCount,
      boardPostCount: view.boardPostCount,
      participantCount: view.participantCount,
      teamCount: view.teamCount,
      connectedRepositoryCount: view.connectedRepositoryCount,
      remainingMilestones: view.remainingMilestones.map((milestone) =>
        RemainingMilestoneResponseDto.from(milestone),
      ),
      viewerRole: view.viewer.role,
      viewerDocumentsCompleted: view.viewer.myDocumentsCompleted,
      viewerDocumentsTotal: view.viewer.myDocumentsTotal,
      fullySubmittedParticipantCount:
        view.viewer.fullySubmittedParticipantCount,
      milestoneDocuments: view.viewer.milestoneDocuments.map((entry) =>
        MilestoneDocumentSummaryResponseDto.from(entry),
      ),
    };
  }
}

export class ProgramOverviewQueryRequestDto {
  @IsOptional()
  @IsIn(['operations'])
  view?: 'operations';
}
