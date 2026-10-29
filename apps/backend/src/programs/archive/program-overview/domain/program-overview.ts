import type { AuthorityLabel } from '../../../../users/domain/authority-label';

export interface ProgramOverviewRecord {
  programId: string;
  name: string;
  trackType: string | null;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;

  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
}

interface PublicTeamMemberRow {
  userId: string;

  displayName: string;
  isLeader: boolean;
}

export interface PublicTeamRow {
  teamId: string;
  name: string;
  members: PublicTeamMemberRow[];
}

export interface ProgramOverviewViewerStats {
  role: AuthorityLabel | null;
  myDocumentsCompleted: number | null;
  myDocumentsTotal: number | null;
  fullySubmittedParticipantCount: number | null;

  milestoneDocuments: ProgramOverviewMilestoneDocument[];
}

export interface ProgramOverviewMilestoneDocument {
  milestoneId: string;
  title: string;
  completed: number;
  total: number;
}

export interface ProgramOverviewRemainingMilestone {
  readonly label: string;
  readonly dueAt: Date;
}

export interface ProgramOverviewView extends ProgramOverviewRecord {
  viewer: ProgramOverviewViewerStats;
  remainingMilestones: readonly ProgramOverviewRemainingMilestone[];
}
