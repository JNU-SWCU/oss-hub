import { Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublicProfileApplicationMode,
  type PublicProfileResponseDto,
} from './dto/public-profile-response.dto';
import {
  PROFILE_ERROR_CODES,
  ProfileErrorCode,
} from './profile-error-code.enum';

@Injectable()
export class PublicProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublicProfile(userId: string): Promise<PublicProfileResponseDto> {
    const contributors = await this.prisma.publicShowcaseContributor.findMany({
      where: { userId },
      include: { repository: true },
      orderBy: [
        { repository: { publishedAt: 'desc' } },
        { repositoryId: 'asc' },
      ],
    });
    const identity = contributors[0];
    if (identity === undefined) {
      throw new DomainException(
        PROFILE_ERROR_CODES[ProfileErrorCode.PUBLIC_PROFILE_NOT_FOUND],
      );
    }

    return {
      userId: identity.userId,
      githubNickname: identity.githubNickname,
      avatarUrl: identity.avatarUrl,
      repositories: contributors.map(({ repository }) => ({
        repositoryId: repository.repositoryId,
        programId: repository.programId,
        programName: repository.programName,
        category: repository.programCategory,
        applicationMode: this.applicationMode(repository.teamName),
        displayName: repository.displayName,
        repositoryName: repository.repositoryName,
        githubUrl: repository.repositoryUrl,
        publishedAt: repository.publishedAt.toISOString(),
        detailUrl: `/archive/${repository.repositoryId}`,
      })),
    };
  }

  private applicationMode(
    teamName: string | null,
  ): PublicProfileApplicationMode {
    return teamName === null
      ? PublicProfileApplicationMode.PERSONAL
      : PublicProfileApplicationMode.TEAM;
  }
}
