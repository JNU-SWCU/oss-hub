import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';

export const PUBLISH_BLOCKED_REASONS = {
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
  REPOSITORY_PUBLICATION_NOT_PLANNED: 'REPOSITORY_PUBLICATION_NOT_PLANNED',
  PROGRAM_NOT_ENDED: 'PROGRAM_NOT_ENDED',
  REQUIRED_MILESTONES_NOT_APPROVED: 'REQUIRED_MILESTONES_NOT_APPROVED',
} as const;

export type PublishBlockedReason =
  (typeof PUBLISH_BLOCKED_REASONS)[keyof typeof PUBLISH_BLOCKED_REASONS];

export interface RepositoryPublishEligibility {
  readonly repositoryId: string;
  readonly visibility: RepositoryVisibility;
  readonly provisionStatus: RepositoryProvisionJobStatus | null;
  readonly requiredMilestonesApproved: boolean;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly programEndAt: Date;
}

export function publishBlockedReasons(
  eligibility: Omit<RepositoryPublishEligibility, 'repositoryId'>,
  now: Date,
): readonly PublishBlockedReason[] {
  if (eligibility.visibility !== RepositoryVisibility.PRIVATE) return [];
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
