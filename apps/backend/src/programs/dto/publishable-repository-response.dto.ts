import { ApiProperty } from '@nestjs/swagger';
import type { RepositoryVisibility } from '@prisma/client';
import {
  PUBLISH_BLOCKED_REASONS,
  type PublishBlockedReason,
} from '../../github/repository-publish.config';
import type { SubmissionReviewContext } from '../submissions.repository';

export class PublishableRepositoryResponseDto {
  declare readonly id: string;
  declare readonly url: string;
  declare readonly visibility: RepositoryVisibility;
  declare readonly publishEligible: boolean;
  @ApiProperty({ enum: Object.values(PUBLISH_BLOCKED_REASONS), isArray: true })
  declare readonly blockedReasons: PublishBlockedReason[];

  static from(
    repository: NonNullable<SubmissionReviewContext['repository']>,
  ): PublishableRepositoryResponseDto {
    return {
      id: repository.id,
      url: repository.url,
      visibility: repository.visibility,
      publishEligible: repository.publishEligible,
      blockedReasons: [...repository.blockedReasons],
    };
  }
}
