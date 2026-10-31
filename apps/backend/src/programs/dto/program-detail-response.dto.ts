import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramTrackType,
  ProgramLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import type { ProgramDetailResult } from '../programs.service';
import type { ProgramActivityResult } from '../program-activity.service';
import type { ProgramViewerRole } from '../program-viewer.service';

type ProgramViewerRoleResponseDto = ProgramViewerRole;
type ViewerSubmissionStatusResponseDto =
  SubmissionStatus | 'NOT_SUBMITTED' | null;

class ApplicationSubmissionSummaryResponseDto {
  declare readonly notSubmitted: number;
  declare readonly submitted: number;
  declare readonly approved: number;
  declare readonly changesRequested: number;
  declare readonly rejected: number;
  declare readonly total: number;

  static from(
    summary: NonNullable<
      ProgramDetailResult['milestones'][number]['applicationSubmissionSummary']
    >,
  ): ApplicationSubmissionSummaryResponseDto {
    return {
      notSubmitted: summary.notSubmitted,
      submitted: summary.submitted,
      approved: summary.approved,
      changesRequested: summary.changesRequested,
      rejected: summary.rejected,
      total: summary.total,
    };
  }
}

class ProgramDetailMilestoneResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly dDay: number;
  declare readonly deadlineLabel: string;
  declare readonly description: string | null;
  declare readonly submissionType: MilestoneSubmissionType | null;

  declare readonly submissionItemCount: number;
  declare readonly viewerSubmissionStatus: ViewerSubmissionStatusResponseDto;
  declare readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResponseDto | null;
  declare readonly startAt: string;
  declare readonly dueAt: string;

  static from(
    milestone: ProgramDetailResult['milestones'][number],
  ): ProgramDetailMilestoneResponseDto {
    return {
      id: milestone.id,
      name: milestone.name,
      dDay: milestone.dDay,
      deadlineLabel: milestone.deadlineLabel,
      description: milestone.description,
      submissionType: milestone.submissionType,
      submissionItemCount: milestone.submissionItemCount,
      viewerSubmissionStatus: milestone.viewerSubmissionStatus,
      applicationSubmissionSummary: milestone.applicationSubmissionSummary
        ? ApplicationSubmissionSummaryResponseDto.from(
            milestone.applicationSubmissionSummary,
          )
        : null,
      startAt: milestone.startAt.toISOString(),
      dueAt: milestone.dueAt.toISOString(),
    };
  }
}

export class ProgramDetailResponseDto {
  declare readonly id: string;
  declare readonly coverImageUrl: string | null;
  declare readonly name: string;
  declare readonly organizer: string;
  declare readonly trackType: ProgramTrackType | null;
  declare readonly applicationTemplateKey: string;

  declare readonly lifecycle: ProgramLifecycle;
  declare readonly description: string;
  declare readonly repositoryProvisioningEnabled: boolean;
  declare readonly viewer: {
    readonly role: ProgramViewerRoleResponseDto;
    readonly applicationStatus: ApplicationStatus | null;
  };
  declare readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  declare readonly operatingPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  declare readonly milestones: readonly ProgramDetailMilestoneResponseDto[];

  static from(result: ProgramDetailResult): ProgramDetailResponseDto {
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
      milestones: result.milestones.map((milestone) =>
        ProgramDetailMilestoneResponseDto.from(milestone),
      ),
    };
  }
}

export class ProgramActivityResponseDto {
  declare readonly applicationId: string;
  declare readonly label: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;
  declare readonly collectionStatus:
    'NOT_CONNECTED' | 'EMPTY' | 'FAILED' | 'READY';
  declare readonly members: readonly {
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
  declare readonly hasIncompleteContributions: boolean;
  declare readonly lastActivityAt: string | null;
  declare readonly dataAsOf: string | null;

  static from(result: ProgramActivityResult): ProgramActivityResponseDto {
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
}
