import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { Prisma, ReviewDecision, SubmissionStatus } from '@prisma/client';

export const APPLICATION_MODES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const;

export type ApplicationMode =
  (typeof APPLICATION_MODES)[keyof typeof APPLICATION_MODES];

/**
 * 공개 확정 게이트 2~5(AGENTS.md "다섯 게이트")의 실패 사유.
 * 게이트 1(`isConfirmed`)은 controller가 보므로 여기에 없다.
 */
export const PUBLISH_BLOCKED_REASONS = {
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
  REPOSITORY_PUBLICATION_NOT_PLANNED: 'REPOSITORY_PUBLICATION_NOT_PLANNED',
  PROGRAM_NOT_ENDED: 'PROGRAM_NOT_ENDED',
  REQUIRED_MILESTONES_NOT_APPROVED: 'REQUIRED_MILESTONES_NOT_APPROVED',
} as const;

export type PublishBlockedReason =
  (typeof PUBLISH_BLOCKED_REASONS)[keyof typeof PUBLISH_BLOCKED_REASONS];

export interface SubmissionReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface SubmissionReviewFileRecord {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
  readonly downloadUrl: string;
}

export interface SubmissionRevisionRecord {
  readonly number: number;
  readonly content: Prisma.JsonValue;
  readonly comment: string | null;
  readonly submittedAt: Date;
  readonly files: readonly SubmissionReviewFileRecord[];
  readonly review: SubmissionReviewRecord | null;
}

export interface SubmissionReviewContext {
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: { readonly id: string; readonly name: string };
  readonly currentRevision: SubmissionRevisionRecord;
  readonly history: readonly SubmissionRevisionRecord[];
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
}

export interface CreateSubmissionReviewInput {
  readonly revision: number;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
}

export interface SubmissionReviewTarget {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
  readonly revision: {
    readonly id: string;
    readonly reviewId: string | null;
  };
}

export interface SubmissionReviewResult {
  readonly reviewId: string;
  readonly submissionStatus: SubmissionStatus;
}

export interface RepositoryPublishEligibility {
  readonly repositoryId: string;
  readonly visibility: RepositoryVisibility;
  readonly provisionStatus: RepositoryProvisionJobStatus | null;
  readonly requiredMilestonesApproved: boolean;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly programEndAt: Date;
}

export interface RepositoryPublishResult {
  readonly repositoryId: string;
  readonly visibility: typeof RepositoryVisibility.PUBLIC;
  readonly publishedAt: Date;
}

/**
 * 공개를 막는 사유를 게이트 순서대로 모두 돌려준다.
 *
 * 검토 화면(`toReviewContext`)과 공개 확정(`publishRepository`)이 **이 함수만** 호출한다 —
 * 한쪽이 조건을 더 보거나 덜 보면 화면은 버튼을 열어 주는데 서버는 거절하는 상태가 된다.
 * 서버는 첫 사유로 거절하고 화면은 전부 나열하므로, 순서는 서버가 던지던 순서를 유지한다.
 */
export function publishBlockedReasons(
  eligibility: Omit<RepositoryPublishEligibility, 'repositoryId'>,
  now: Date,
): readonly PublishBlockedReason[] {
  // 이미 공개된 저장소는 게이트 대상이 아니다.
  if (eligibility.visibility !== RepositoryVisibility.PRIVATE) return [];
  // ⚠ 이 순서가 계약이다 — 공개 확정이 **첫 사유로** 거절하므로, 순서를 바꾸면
  // 여러 게이트가 동시에 막힌 교직원이 보던 오류 코드가 바뀐다(AGENTS.md 「다섯 게이트」).
  return [
    ...(eligibility.provisionStatus === RepositoryProvisionJobStatus.SUCCEEDED
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY]),
    ...(eligibility.isRepositoryPublicationPlanned
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED]),
    ...(eligibility.programEndAt.getTime() <= now.getTime()
      ? []
      : [PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED]),
    ...(eligibility.requiredMilestonesApproved
      ? []
      : [PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED]),
  ];
}
