import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RepositoryOwner {
  readonly githubRepositoryId: bigint;
  readonly ownerGithubId: bigint;
  readonly ownerGithubLogin: string;
}

export interface RepositoryOwnerProjectionClient {
  readonly repositoryOwnerProjection: {
    findMany(args: {
      readonly where: {
        readonly githubRepositoryId: { readonly in: readonly bigint[] };
      };
      readonly select: {
        readonly githubRepositoryId: true;
        readonly ownerGithubId: true;
        readonly ownerGithubLogin: true;
      };
    }): Promise<readonly RepositoryOwner[]>;
  };
}

@Injectable()
export class RepositoryOwnerRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: RepositoryOwnerProjectionClient,
  ) {}

  async findByGithubRepositoryIds(
    githubRepositoryIds: readonly bigint[],
  ): Promise<readonly RepositoryOwner[]> {
    if (githubRepositoryIds.length === 0) return [];

    return this.prisma.repositoryOwnerProjection.findMany({
      where: { githubRepositoryId: { in: [...githubRepositoryIds] } },
      select: {
        githubRepositoryId: true,
        ownerGithubId: true,
        ownerGithubLogin: true,
      },
    });
  }
}
