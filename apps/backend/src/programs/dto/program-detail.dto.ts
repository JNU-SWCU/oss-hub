import type { AuthorityLabel } from '../../common/authority-label';
import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  SubmissionStatus,
} from '@prisma/client';

/**
 * 프로그램 상세가 뷰어를 한 단어로 부르는 값. 표시 전용이다.
 *
 * `PENDING`은 승인을 기다리는 교직원이라 표시 역할과 같은 칸에 들어간다 — 화면이
 * "심사 중" 안내를 내는 근거이고, 권한 판정에는 쓰지 않는다.
 */
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
  readonly submissionType: MilestoneSubmissionType;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResponseDto;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResponseDto | null;
}

export interface ProgramDetailResponseDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
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
}
