import type { AuthorityLabel } from '../../users/domain/authority-label';
import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramTrackType,
  ProgramLifecycle,
  SubmissionStatus,
} from '@prisma/client';

export type ProgramViewerRoleResponseDto = AuthorityLabel | 'PENDING' | null;
export type ViewerSubmissionStatusResponseDto =
  SubmissionStatus | 'NOT_SUBMITTED' | null;

export interface ApplicationSubmissionSummaryResponseDto {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: MilestoneSubmissionType | null;

  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResponseDto;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResponseDto | null;
}

export interface ProgramDetailResponseDto {
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
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly operatingPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly viewer: {
    readonly role: ProgramViewerRoleResponseDto;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneResponseDto[];
}

export interface ProgramActivityResponseDto {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
  readonly collectionStatus: 'NOT_CONNECTED' | 'EMPTY' | 'FAILED' | 'READY';
  readonly members: readonly {
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
  readonly hasIncompleteContributions: boolean;
}
