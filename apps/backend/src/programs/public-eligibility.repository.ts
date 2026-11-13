import { PlatformRepository } from '../platform/platform.repository';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { RepoLedgerRepository } from '../platform/repo-ledger.repository';

export interface RepositoryObservationRow {
  readonly repositoryId: bigint;
  readonly visibility: 'PRIVATE' | 'PUBLIC';
  readonly presence: 'PRESENT' | 'ABSENT';
  readonly visibilityObservedAt: Date | null;
}

@Injectable()
export class PublicEligibilityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}

  async findRepositoryObservations(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepositoryObservationRow[]> {
    const repositories = await this.prisma.repo.findMany({
      where: {
        githubRepoId: { in: [...repositoryIds] },
        ...this.platformRepository.linkedRepoWhere(),
      },
      select: { githubRepoId: true, visibility: true, presence: true },
    });
    const observations = await new RepoLedgerRepository().observations(
      this.prisma,
      repositories.map((repository) => repository.githubRepoId),
    );
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepoId,
      visibility: repository.visibility,
      presence: repository.presence,
      visibilityObservedAt:
        observations.get(repository.githubRepoId)
          ?.lastCompleteInventoryObservedAt ?? null,
    }));
  }
}
