import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type RankingUserEligibilityRow = {
  readonly githubUserId: bigint;
};

export interface RankingUserEligibilityProjectionClient {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
}

@Injectable()
export class RankingUserEligibilityRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: RankingUserEligibilityProjectionClient,
  ) {}

  async findEligibleGithubIds(
    githubUserIds: readonly bigint[],
  ): Promise<ReadonlySet<bigint>> {
    const uniqueGithubUserIds = [...new Set(githubUserIds)];
    if (uniqueGithubUserIds.length === 0) return new Set();

    const rows = await this.prisma.$queryRaw<RankingUserEligibilityRow[]>(
      Prisma.sql`
        SELECT "githubUserId"
        FROM "RankingUserEligibilityProjection"
        WHERE "githubUserId" IN (${Prisma.join(uniqueGithubUserIds)})
      `,
    );
    return new Set(rows.map((row) => row.githubUserId));
  }
}
