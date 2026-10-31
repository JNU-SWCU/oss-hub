import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import {
  RepositoryPublishEligibility,
  PublishBlockedReason,
  PUBLISH_BLOCKED_REASONS,
} from './repository-publish.config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RepositoryPublishService {
  publishBlockedReasons(
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
}
