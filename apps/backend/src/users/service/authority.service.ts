import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { UsersAuthorityRepository } from '../repository/authority.repository';

@Injectable()
export class UsersAuthorityService {
  constructor(
    @Inject(UsersAuthorityRepository)
    private readonly repository: Pick<
      UsersAuthorityRepository,
      'findActorByGithubId'
    >,
  ) {}

  async assertActiveStaff(
    sessionGithubId: bigint,
    forbidden: () => Error,
  ): Promise<{ actorId: string }> {
    const actor = await this.repository.findActorByGithubId(sessionGithubId);
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    ) {
      throw forbidden();
    }
    return { actorId: actor.id };
  }

  async assertAdmin(
    sessionGithubId: bigint,
    forbidden: () => Error,
  ): Promise<{ actorId: string }> {
    const actor = await this.repository.findActorByGithubId(sessionGithubId);
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      !actor.hasAdminAccess
    ) {
      throw forbidden();
    }
    return { actorId: actor.id };
  }
}
