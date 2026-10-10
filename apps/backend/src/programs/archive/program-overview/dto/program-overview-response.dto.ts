import type { AuthorityLabel } from '../../../../users/domain/authority-label';
import {
  ProgramOverviewMilestoneDocument,
  ProgramOverviewRemainingMilestone,
  ProgramOverviewView,
} from '../domain/program-overview';

export class RemainingMilestoneResponseDto {
  readonly label: string;
  readonly dueAt: string;

  private constructor(milestone: ProgramOverviewRemainingMilestone) {
    this.label = milestone.label;
    this.dueAt = milestone.dueAt.toISOString();
  }

  static from(
    milestone: ProgramOverviewRemainingMilestone,
  ): RemainingMilestoneResponseDto {
    return new RemainingMilestoneResponseDto(milestone);
  }
}

export class MilestoneDocumentSummaryResponseDto {
  readonly milestoneId: string;
  readonly title: string;
  readonly completed: number;
  readonly total: number;

  private constructor(entry: ProgramOverviewMilestoneDocument) {
    this.milestoneId = entry.milestoneId;
    this.title = entry.title;
    this.completed = entry.completed;
    this.total = entry.total;
  }

  static from(
    entry: ProgramOverviewMilestoneDocument,
  ): MilestoneDocumentSummaryResponseDto {
    return new MilestoneDocumentSummaryResponseDto(entry);
  }
}

export class ProgramOverviewResponseDto {
  programId: string;
  name: string;
  trackType: string | null;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;

  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
  remainingMilestones: RemainingMilestoneResponseDto[];

  viewerRole: AuthorityLabel | null;

  viewerDocumentsCompleted: number | null;

  viewerDocumentsTotal: number | null;

  fullySubmittedParticipantCount: number | null;

  milestoneDocuments: MilestoneDocumentSummaryResponseDto[];

  private constructor(view: ProgramOverviewView) {
    this.programId = view.programId;
    this.name = view.name;
    this.trackType = view.trackType;
    this.lifecycle = view.lifecycle;
    this.milestoneCount = view.milestoneCount;
    this.boardPostCount = view.boardPostCount;
    this.participantCount = view.participantCount;
    this.teamCount = view.teamCount;
    this.connectedRepositoryCount = view.connectedRepositoryCount;
    this.remainingMilestones = view.remainingMilestones.map((milestone) =>
      RemainingMilestoneResponseDto.from(milestone),
    );
    this.viewerRole = view.viewer.role;
    this.viewerDocumentsCompleted = view.viewer.myDocumentsCompleted;
    this.viewerDocumentsTotal = view.viewer.myDocumentsTotal;
    this.fullySubmittedParticipantCount =
      view.viewer.fullySubmittedParticipantCount;
    this.milestoneDocuments = view.viewer.milestoneDocuments.map((entry) =>
      MilestoneDocumentSummaryResponseDto.from(entry),
    );
  }

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return new ProgramOverviewResponseDto(view);
  }
}
