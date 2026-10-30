import type {
  BoardPostCategory,
  ProgramCategory,
  ApplicationStatus,
  ProgramLifecycle,
  ProgramTrackType,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../users/authority-label.policy';
import type { ProgramExternalCover } from './program-authoring.policy';
import type {
  PublicProjectRow,
  PublicUserIdentity,
} from './public-projects.policy';

export interface BoardPostListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface BoardPostPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

export interface BoardPostSummaryResult extends BoardPostPermissions {
  id: string;
  programId: string;
  authorId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: Date;
  commentCount: number;
}

export interface BoardCommentResult {
  id: string;
  postId: string;
  authorId: string;
  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: Date;
  canDelete: boolean;
}

export interface BoardPostDetailResult extends BoardPostSummaryResult {
  body: string;
  updatedAt: Date;
  comments: BoardCommentResult[];
}

export interface BoardPostsPageResult {
  items: BoardPostSummaryResult[];
  total: number;
  page: number;
  limit: number;
}

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
] as const;

export type MilestoneDocumentCollectionFilter =
  (typeof MILESTONE_DOCUMENT_COLLECTION_FILTERS)[number];

export interface MilestoneDocumentCollectionQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}

export type ProgramCoverChange = {
  readonly actorId: string;
} & (
  | { readonly uploadId: string | null; readonly externalCover?: never }
  | {
      readonly externalCover: ProgramExternalCover | null;
      readonly uploadId?: never;
    }
);

export type CreatedProgram = {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly endAt: Date;
};

export type ProgramListRecord = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
  readonly description: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
};

export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface PersonalizedProgramListItem extends ProgramListRecord {
  readonly note?: ProgramListItemNote;

  readonly viewerApplicationStatus?: ApplicationStatus;

  readonly applicationCount?: number;

  readonly pendingApplicationCount?: number;
}

export interface ProgramListPage {
  readonly items: readonly PersonalizedProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

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

export type ProgramPurgeDeletedCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
};

export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};

export type ProgramViewerRole = AuthorityLabel | 'PENDING' | null;
type ViewerSubmissionStatusResult = SubmissionStatus | 'NOT_SUBMITTED' | null;

export interface ApplicationSubmissionSummaryResult {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

interface ProgramMilestoneResult {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: MilestoneSubmissionType | null;

  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResult;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResult | null;
}

export interface ProgramDetailResult {
  readonly coverImageUrl: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;

  readonly lifecycle: ProgramLifecycle;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly operatingPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly viewer: {
    readonly role: ProgramViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneResult[];
}

export interface ProgramActivityResult {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: Date | null;
  readonly dataAsOf: Date | null;
  readonly collectionStatus: 'NOT_CONNECTED' | 'EMPTY' | 'FAILED' | 'READY';
  readonly members: readonly {
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
  readonly hasIncompleteContributions: boolean;
}

export type CreateProgramCommand = {
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt?: string;
  readonly endAt: string;
  readonly teamMinSize?: number | null;
  readonly teamMaxSize?: number | null;
  readonly description: string;
};

export type UpdateProgramCommand = Omit<CreateProgramCommand, 'endAt'> & {
  readonly endAt?: string | null;
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export type UpsertMilestoneCommand = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
};

type EditMilestoneDocumentCommand = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type EditMilestoneCommand = {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly EditMilestoneDocumentCommand[];
  readonly expectedFingerprint: string;
};

export type MilestoneUpdateCommand =
  | { readonly kind: 'aggregate'; readonly input: EditMilestoneCommand }
  | { readonly kind: 'legacy'; readonly input: UpsertMilestoneCommand };

export interface PublicProjectPageResult {
  readonly items: readonly PublicProjectRow[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
}

export interface PublicProjectMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectContributor {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectDetailResult {
  readonly row: PublicProjectRow;
  readonly metrics: PublicProjectMetrics;
  readonly contributors: readonly PublicProjectContributor[];
}

export interface PublicUserProfileProjectResult {
  readonly row: PublicProjectRow;
  readonly observed: boolean;
  readonly hasCollectedData: boolean;
  readonly dataAsOf: Date | null;
  readonly metrics: PublicProjectMetrics | null;
}

export interface PublicUserProfileResult {
  readonly identity: PublicUserIdentity;
  readonly projects: readonly PublicUserProfileProjectResult[];

  readonly observedTotals: PublicProjectMetrics;
}
