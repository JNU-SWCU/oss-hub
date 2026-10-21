import type { ViewerRole } from '../program-contract';

interface ProgramOverviewMilestoneDocument {
  readonly milestoneId: string;
  readonly title: string;
  readonly completed: number;
  readonly total: number;
}

export interface ProgramOverview {
  readonly programId: string;
  readonly name: string;
  readonly trackType: string | null;
  readonly lifecycle: string;
  readonly milestoneCount: number;
  readonly boardPostCount: number;
  readonly participantCount: number;
  readonly teamCount: number;
  readonly connectedRepositoryCount: number;
  readonly viewerRole: ViewerRole;

  readonly viewerDocumentsCompleted: number | null;

  readonly viewerDocumentsTotal: number | null;

  readonly fullySubmittedParticipantCount: number | null;

  readonly remainingMilestones: readonly {
    readonly label: string;
    readonly dueAt: string;
  }[];

  readonly milestoneDocuments: readonly ProgramOverviewMilestoneDocument[];
}
