import type { AuthorityLabel } from '../../users/domain/authority-label';
import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramTrackType,
  ProgramLifecycle,
  SubmissionStatus,
} from '@prisma/client';

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
