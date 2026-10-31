import { PlatformRepository } from '../platform/platform.repository';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

export interface RepositoryObservationRow {
  readonly repositoryId: bigint;
  readonly visibility: 'PRIVATE' | 'PUBLIC';
  readonly presence: 'PRESENT' | 'ABSENT';
  readonly visibilityObservedAt: Date | null;
}

@Injectable()
export class PublicEligibilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRepositoryObservations(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepositoryObservationRow[]> {
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...repositoryIds] },
        ...PlatformRepository.linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        visibility: true,
        presence: true,
        lastCompleteInventoryObservedAt: true,
      },
    });
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      visibility: repository.visibility,
      presence: repository.presence,
      visibilityObservedAt: repository.lastCompleteInventoryObservedAt,
    }));
  }
}
