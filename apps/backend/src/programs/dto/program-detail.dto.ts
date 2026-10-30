import type {
  ProgramDetailResult,
  ProgramActivityResult,
  ProgramViewerRole,
} from '../programs.types';
import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramTrackType,
  ProgramLifecycle,
  SubmissionStatus,
} from '@prisma/client';

type ProgramViewerRoleResponseDto = ProgramViewerRole;
type ViewerSubmissionStatusResponseDto =
  SubmissionStatus | 'NOT_SUBMITTED' | null;

interface ApplicationSubmissionSummaryResponseDto {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

interface ProgramMilestoneResponseDto {
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

export function programDetailResponse(
  result: ProgramDetailResult,
): ProgramDetailResponseDto {
  return {
    id: result.id,
    coverImageUrl: result.coverImageUrl,
    name: result.name,
    organizer: result.organizer,
    trackType: result.trackType,
    applicationTemplateKey: result.applicationTemplateKey,
    lifecycle: result.lifecycle,
    description: result.description,
    repositoryProvisioningEnabled: result.repositoryProvisioningEnabled,
    viewer: {
      role: result.viewer.role,
      applicationStatus: result.viewer.applicationStatus,
    },
    applicationPeriod: {
      startsAt: result.applicationPeriod.startsAt.toISOString(),
      endsAt: result.applicationPeriod.endsAt.toISOString(),
    },
    operatingPeriod: {
      startsAt: result.operatingPeriod.startsAt.toISOString(),
      endsAt: result.operatingPeriod.endsAt.toISOString(),
    },
    milestones: result.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      dDay: milestone.dDay,
      deadlineLabel: milestone.deadlineLabel,
      description: milestone.description,
      submissionType: milestone.submissionType,
      submissionItemCount: milestone.submissionItemCount,
      viewerSubmissionStatus: milestone.viewerSubmissionStatus,
      applicationSubmissionSummary: milestone.applicationSubmissionSummary
        ? {
            notSubmitted: milestone.applicationSubmissionSummary.notSubmitted,
            submitted: milestone.applicationSubmissionSummary.submitted,
            approved: milestone.applicationSubmissionSummary.approved,
            changesRequested:
              milestone.applicationSubmissionSummary.changesRequested,
            rejected: milestone.applicationSubmissionSummary.rejected,
            total: milestone.applicationSubmissionSummary.total,
          }
        : null,
      startAt: milestone.startAt.toISOString(),
      dueAt: milestone.dueAt.toISOString(),
    })),
  };
}

export function programActivityResponse(
  result: ProgramActivityResult,
): ProgramActivityResponseDto {
  return {
    applicationId: result.applicationId,
    label: result.label,
    commitCount: result.commitCount,
    pullRequestCount: result.pullRequestCount,
    releaseCount: result.releaseCount,
    collectionStatus: result.collectionStatus,
    members: result.members.map((member) => ({
      githubLogin: member.githubLogin,
      commitCount: member.commitCount,
      pullRequestCount: member.pullRequestCount,
      releaseCount: member.releaseCount,
    })),
    hasIncompleteContributions: result.hasIncompleteContributions,
    lastActivityAt: result.lastActivityAt?.toISOString() ?? null,
    dataAsOf: result.dataAsOf?.toISOString() ?? null,
  };
}
