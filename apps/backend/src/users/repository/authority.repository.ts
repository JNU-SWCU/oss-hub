import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersAuthorityRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: Pick<PrismaService, 'user'>,
  ) {}

  async findActorByGithubId(sessionGithubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }
}
