import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
  type CompatibleProfileNameSource,
} from '../profiles/profile-compatibility';

export interface UserDisplayName {
  readonly githubId: bigint;
  /** UserProfile.name이 있으면 그 값, 없으면 구버전 User.name — 없으면 null. */
  readonly name: string | null;
}

type UserDisplayNameRow = CompatibleProfileNameSource & {
  readonly githubId: bigint;
};

export interface UserDisplayNameProjectionClient {
  readonly user: {
    // `in`은 Prisma의 실제 `UserFindManyArgs`와 맞추기 위해 mutable 배열이다 — 호출부는
    // 항상 새로 만든 배열(`[...githubIds]`)을 넘기므로 실제 PrismaService에도 그대로
    // 대입 가능하다(readonly 배열은 Prisma의 mutable 배열 타입에 대입되지 않는다).
    findMany(args: {
      readonly where: {
        readonly githubId: { readonly in: bigint[] };
      };
      readonly select: {
        readonly githubId: true;
      } & typeof COMPATIBLE_PROFILE_NAME_SELECT;
    }): Promise<readonly UserDisplayNameRow[]>;
  };
}

@Injectable()
export class UserDisplayNameStore {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: UserDisplayNameProjectionClient,
  ) {}

  async findByGithubIds(
    githubIds: readonly bigint[],
  ): Promise<readonly UserDisplayName[]> {
    if (githubIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { githubId: { in: [...githubIds] } },
      select: { githubId: true, ...COMPATIBLE_PROFILE_NAME_SELECT },
    });
    return users.map((user) => ({
      githubId: user.githubId,
      name: resolveCompatibleProfileName(user),
    }));
  }
}
