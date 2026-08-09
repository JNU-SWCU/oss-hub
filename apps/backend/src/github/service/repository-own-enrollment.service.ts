import { Injectable } from '@nestjs/common';
import type { ConsentsService } from '../../consents/consents.service';
import type { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';

export interface OwnRepositoryEnrollmentInput {
  readonly applicantGithubId: bigint;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly defaultBranch: string;
  readonly archived: boolean;
  readonly observedAt: Date;
}

@Injectable()
export class RepositoryOwnEnrollmentService {
  constructor(
    private readonly consents: Pick<ConsentsService, 'requireCurrent'>,
    private readonly enrollment: Pick<
      CollectionIncrementalRepository,
      'enrollExternalRepository'
    >,
  ) {}

  async enrollExternalRepository(
    input: OwnRepositoryEnrollmentInput,
  ): Promise<void> {
    await this.consents.requireCurrent(input.applicantGithubId);
    await this.enrollment.enrollExternalRepository({
      githubRepositoryId: input.githubRepositoryId,
      nameWithOwner: input.nameWithOwner,
      defaultBranch: input.defaultBranch,
      archived: input.archived,
      observedAt: input.observedAt,
    });
  }
}
